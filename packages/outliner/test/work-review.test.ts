// PIE-1388: the workboard's rules where agents act. A completion proved by tests alone and a ticket that doesn't say
// what Evan will open are answered fix, in the words the outline's house-rule note gives them. Code's words decide here
// (the preload switches Jev off); made-up tickets.
import { expect, test } from "bun:test";
import { HOUSE_RULE_DEFAULTS, houseRule, reviewCompletion, reviewTicket } from "../src/work-review";

const ticket = { id: "t-1", text: "GARD-7 — The seed list sorts by sowing month [type::roadmap-item]\n\nEvan opens the seed list and finds this month's seeds first." };
const none = { request: async () => ({ blocks: [] }) } as never;
const worded = { request: async () => ({ blocks: [{ id: "rule-1", text: "Verification belongs to the agent [house-rule::validation]\n\nAn agent that didn't build it drives the app and judges it." }] }) } as never;

test("a completion proved by tests alone is a fix; one that says the app was driven ships; a test-only ticket is left be", async () => {
  const tests = await reviewCompletion(none, { ticket, proof: "bun test green, 14 pass, box-test exit 0" });
  expect(tests.review.verdict).toBe("fix");
  expect(tests.review.findings[0]).toMatchObject({ rule: "proof-only-tests", rubric: "qa-for-evan" });
  expect(tests.review.findings[0]!.say).toContain(HOUSE_RULE_DEFAULTS.validation);
  expect((await reviewCompletion(none, { ticket, proof: "Drove it in a scratch door: the seed list opened on October's seeds." })).review.verdict).toBe("ship");
  expect((await reviewCompletion(none, { ticket: { id: "t-2", text: "GARD-8 — Refactor the seed sorter" }, proof: "bun test green" })).review.verdict).toBe("ship");
  // The outline's note words it, linked.
  expect((await reviewCompletion(worded, { ticket, proof: "tests pass" })).review.findings[0]!.say).toContain("drives the app and judges it. ((rule-1))");
});

test("a ticket that says what Evan will open ships; one that doesn't is a fix", async () => {
  expect((await reviewTicket(none, ticket)).review.verdict).toBe("ship");
  const vague = await reviewTicket(none, { id: "t-3", text: "GARD-9 — Seed sorter improvements\n\nMake sorting better and faster." });
  expect(vague.review.findings[0]).toMatchObject({ rule: "no-experience", rubric: "experience" });
  expect(await houseRule(none, "experience")).toContain("[house-rule::experience]");
  // PIE-1402: any "Evan <does> … and <sees>" sentence is one, not only "Evan opens".
  const writes = { id: "t-4", text: "GARD-10 — Comments reach the gardener\n\n**The sentence:** Evan writes \"@moss …\" in a comment on any note, and moss's session hears it within half an hour." };
  expect((await reviewTicket(none, writes)).review.verdict).toBe("ship");
});
