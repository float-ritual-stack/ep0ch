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

// Seen in use, Oct 29: "no action reads like it" while a page was the place to look. Pages and views are candidates:
// the ones that link the ticket first, then the matcher's by their words.
const place = (id: string, text: string, page?: string) => ({ id, text, properties: page ? [{ key: "page", value: page }] : [{ key: "type", value: "virtual-branch" }] }) as unknown as Block;
const LOG = place("p-log", "Watering log [page::watering-log]\n\nWhich beds were watered each day.", "watering-log");
const SHED = place("p-shed", "Shed paint colours [page::shed]\n\nSamples on the shed door.", "shed");
const MINE = place("p-mine", "Garden checks [for::GDN-9]\n\nWhat to look at in the garden.");
const SEEDS = ticket("GDN-9", "Seedlings get a reminder before frost", "Internal: the frost job reads the forecast.");

test("places: the ones that link the ticket first, then the matcher's by their words; the rest left out", async () => {
  const { placeCandidates } = await import("../src/work-try");
  expect(placeCandidates(SEEDS, [LOG, SHED, MINE], new Set(["p-mine"])).map(c => [c.place.id, c.links])).toEqual([["p-mine", true]]);
  const byWords = placeCandidates(WATER, [LOG, SHED, MINE]).map(c => c.place.id);
  expect(byWords[0]).toBe("p-log");
  expect(byWords).not.toContain("p-shed");
  // A page deep search found by meaning shares no word; it still gets a place, the matcher's weakest giving way.
  expect(placeCandidates(WATER, [LOG, SHED, MINE], new Set(), ["p-shed"]).map(c => c.place.id)).toContain("p-shed");
});

test("Jev picks the pages to open, and a ticket with only a place to open is no longer a finding", async () => {
  const fake = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(r) {
    const body = await r.json() as { questions: Record<string, { instructions: string }> };
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul: id.startsWith("opens::") && (q.instructions.includes("Garden checks") || q.instructions.includes("Watering log")) ? 0.85 : 0.1 }]));
    return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 300, output_tokens: 0 } });
  } });
  fakes.push(fake);
  const open = { name: "screen.open", summary: "open a screen by name" };
  const report = await planTries([SEEDS], ACTIONS, { apiKey: "fake", endpoint: `http://127.0.0.1:${fake.port}/v1/systemone`, places: [LOG, SHED, MINE], links: { [SEEDS.id]: ["p-mine"] }, open });
  const md = tryMarkdown(report);
  expect(md).toContain("- [ ] **Open:** ((p-mine|Garden checks)) · a view · it links the ticket · `ep0ch act screen.open name=detail target=p-mine`");
  expect(md).not.toContain("**Finding:**");
  // With Jev off, the linked place and the matcher's are the plan.
  const off = tryMarkdown(await planTries([WATER], ACTIONS, { jev: false, places: [LOG, SHED] }));
  expect(off).toContain("**Open:** ((p-log|Watering log)) · [[watering-log]]");
});
