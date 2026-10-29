// PIE-1086 and PIE-1272: an agent hears what became of its proposals, and runs a script the way a person presses it.
// Scratch services in temp folders (script-harness); every note, name and actor is made up.
import { expect, test } from "bun:test";
import { runAgentOperation } from "../src/agent-tools";
import type { DraftPatchResult } from "../src/draft-patch";
import type { ProposalOutcomesPage } from "../src/proposal-outcomes";
import { setup, until } from "./script-harness";

const WREN = { author: "agent" as const, actorId: "wren/claude-code@scratch-box" };
const MOTH = { author: "agent" as const, actorId: "mcp:moth/claude.ai" };

test("each proposal's outcome reaches its author once, in order: proposed, stale, then applied or dismissed", async () => {
  const { client, create, store } = await setup();
  const note = create("Seed swap\nBring borlotti.\nBring chard.");
  const propose = async (observed: string, replacement: string, mutation = WREN) => {
    const now = store.require(note.id);
    const r = await client.request<DraftPatchResult>({ action: "draft.patch", propose: true, blockId: note.id, revision: now.revision, patches: [{ observed, replacement }], mutation });
    if (r.outcome !== "proposed") throw new Error(`expected a proposal, got ${r.outcome}`);
    return r.proposalId;
  };
  const kept = await propose("Bring borlotti.", "Bring borlotti and runner beans.");
  const dropped = await propose("Bring chard.", "Bring rainbow chard.");
  await propose("Bring chard.", "Bring no chard.", MOTH);
  const first = await runAgentOperation(client, "proposals", {}, { actorId: WREN.actorId }) as ProposalOutcomesPage;
  expect(first.outcomes.map(o => [o.proposal, o.state])).toEqual([[kept, "proposed"], [dropped, "proposed"]]);
  expect(first.outcomes[0]!.note).toBe(note.id);
  expect(first.outcomes[0]!.title).toBe("Seed swap");
  expect(first.complete).toBe(true);

  // The person edits the note elsewhere: both open proposals go stale, said once each, with who changed it.
  await Bun.sleep(5);
  const now = store.require(note.id);
  await client.request({ action: "update", blockId: note.id, text: `${now.text}\nBring string.`, expectedRevision: now.revision, mutation: { author: "user" } });
  await until("the proposals to go stale", () => store.get(dropped)!.text.split("\n", 1)[0]!.includes("[stale::true]"));
  await Bun.sleep(5);
  await client.request({ action: "draft.proposal.apply", proposalId: kept, mutation: { author: "user" } }).catch(() => undefined);
  await client.request({ action: "draft.proposal.dismiss", proposalId: dropped, mutation: { author: "user" } });

  const next = await runAgentOperation(client, "proposals", { since: first.cursor }, { actorId: WREN.actorId }) as ProposalOutcomesPage;
  const states = (id: string) => next.outcomes.filter(o => o.proposal === id).map(o => o.state);
  expect(states(dropped)).toEqual(["stale", "dismissed"]);
  expect(states(kept)[0]).toBe("stale");
  expect(next.outcomes.find(o => o.state === "stale")!.reason).toContain("the note changed since");
  expect(next.outcomes.find(o => o.state === "dismissed")!.by).toBe("user");
  // Asked again from the cursor, nothing comes twice.
  const again = await runAgentOperation(client, "proposals", { since: next.cursor }, { actorId: WREN.actorId }) as ProposalOutcomesPage;
  expect(again.outcomes).toEqual([]);

  // A persona hears every client it writes through; another persona's proposals aren't its own.
  const moth = await runAgentOperation(client, "proposals", { actor: "moth" }, undefined) as ProposalOutcomesPage;
  expect(moth.outcomes.map(o => o.state)).toEqual(["proposed", "stale"]);
  const wrenAnywhere = await runAgentOperation(client, "proposals", {}, { actorId: "mcp:wren/claude.ai" }) as ProposalOutcomesPage;
  expect(wrenAnywhere.outcomes.filter(o => o.state === "proposed").length).toBe(2);
});

test("script-run gives the script `this` and its slots, as a press in that note would", async () => {
  const { client, create, extensionOf, store } = await setup();
  store.configureMcpAccess("full");
  const script = create("Lantern [script::lantern]\n```js\nreturn `${this?.title ?? 'no note'}: card ${props.card?.[0] ?? 'none'}, choice ${props.choice?.[0] ?? 'none'}`;\n```");
  await extensionOf("lantern");
  const cave = create("The Undercroft");
  const pressed = await runAgentOperation(client, "script-run", { ref: script.id, this: cave.id, slots: { card: "lamplighter", choice: "2" } }, { actorId: WREN.actorId }) as { message: string };
  expect(pressed.message).toBe("The Undercroft: card lamplighter, choice 2");
  const bare = await runAgentOperation(client, "script-run", { ref: script.id }, { actorId: WREN.actorId }) as { message: string };
  // Without `this` the run has no note, as an MCP run had before (PIE-1272): the script says so.
  expect(bare.message).toContain("this run has no note");
  await expect(runAgentOperation(client, "script-run", { ref: script.id, slots: { card: ["a"] } }, { actorId: WREN.actorId })).rejects.toThrow("one line of text");
});

test("a persona answers for its own clients only; a principal is only itself", async () => {
  const { proposalAuthoredBy } = await import("../src/proposal-outcomes");
  expect(proposalAuthoredBy("mcp:wren/claude.ai", "wren")).toBe(true);
  expect(proposalAuthoredBy("wren/claude-code@scratch-box", "mcp:wren/claude.ai")).toBe(true);
  expect(proposalAuthoredBy("claude-code@scratch-box", "claude-code")).toBe(false);
  expect(proposalAuthoredBy("claude-code@scratch-box", "claude-code@other-box")).toBe(false);
  expect(proposalAuthoredBy("claude-code@scratch-box", "claude-code@scratch-box")).toBe(true);
});

test("a cut page never splits one save's outcomes: what shares the last time comes next, none lost", async () => {
  const { client, create, store } = await setup();
  const note = create("Pond jobs\nNet the leaves.\nTop up the water.\nCheck the pump.");
  for (const [observed, replacement] of [["Net the leaves.", "Net the leaves weekly."], ["Top up the water.", "Top up with rain water."], ["Check the pump.", "Clean the pump."]]) {
    const now = store.require(note.id);
    await client.request<DraftPatchResult>({ action: "draft.patch", propose: true, blockId: note.id, revision: now.revision, patches: [{ observed: observed!, replacement: replacement! }], mutation: WREN });
  }
  const first = await runAgentOperation(client, "proposals", {}, { actorId: WREN.actorId }) as ProposalOutcomesPage;
  await Bun.sleep(5);
  const now = store.require(note.id);
  // One save makes all three stale, in one go.
  await client.request({ action: "update", blockId: note.id, text: `${now.text}\nFeed the fish.`, expectedRevision: now.revision, mutation: { author: "user" } });
  await until("all three stale", () => runAgentOperation(client, "proposals", { since: first.cursor }, { actorId: WREN.actorId }).then(p => (p as ProposalOutcomesPage).outcomes.length === 3));
  const seen: string[] = [];
  let since = first.cursor;
  for (let i = 0; i < 5; i++) {
    const page = await runAgentOperation(client, "proposals", { since, limit: 2 }, { actorId: WREN.actorId }) as ProposalOutcomesPage;
    seen.push(...page.outcomes.map(o => `${o.proposal}@${o.revision}`));
    since = page.cursor;
    if (page.complete) break;
  }
  expect(new Set(seen).size).toBe(3);
});
