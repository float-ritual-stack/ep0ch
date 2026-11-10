// Machinery (PIE-867): what tools stamp `[machine::<producer>]` is left out of what a person reads unless they ask.
// One flag, `machinery: hide|only|show`, on the questions, the search, the activity list, the change feed and a saved
// view's note. Fictional notes only.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { findBlocks } from "../src/agent-tools";
import type { Block, ChangeFeedPage } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "machinery-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new OutlinerStore(join(directory, "o.sqlite"));
  const socket = join(directory, "o.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); });
  const client = new OutlinerClient(socket);
  const make = (text: string, author: "user" | "agent" = "user") => client.request<Block>({ action: "create", text, author });
  return { store, client, make };
}

test("a stamped note is hidden by default, alone with only, and with the rest on show: queries, search, activity and the change feed", async () => {
  const { client, make } = await setup();
  const gate = await make("Mend the garden gate [type::chore]");
  const toss0 = await make("Toss one [type::toss] [machine::echonet]", "agent");
  const toss = await client.request<Block>({ action: "update", blockId: toss0.id, text: "Toss one, done [type::toss] [machine::echonet]", expectedRevision: toss0.revision, mutation: { author: "agent", actorId: "echonet" } } as never);
  const names = (blocks: Block[]) => blocks.map(b => b.id).sort();
  const ask = async (machinery?: string) => names((await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "type=chore OR type=toss", ...(machinery ? { machinery } : {}) } as never })).blocks);
  expect(await ask()).toEqual([gate.id]);
  expect(await ask("hide")).toEqual([gate.id]);
  expect(await ask("only")).toEqual([toss.id]);
  expect(await ask("show")).toEqual([gate.id, toss.id].sort());
  await expect(ask("none")).rejects.toThrow("hide, only or show");
  // A question that names `machine` itself is answered as written, whatever the flag; one that hides says how many it hid.
  const written = async (where: string) => names((await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where, machinery: "hide" } as never })).blocks);
  expect(await written("machine=echonet")).toEqual([toss.id]);
  expect(await written("type=chore OR type=toss")).toEqual([gate.id]);
  const said = await client.request<{ machineryHidden?: number; hint?: string }>({ action: "blocks.query", query: { where: "type=toss" } as never });
  expect([said.machineryHidden, said.hint]).toEqual([1, "1 machinery note hidden · machinery=show"]);

  const search = async (machinery?: string) => (await client.request<{ candidates?: { id: string }[]; results?: { id: string }[] }>({ action: "tree.search", query: "toss", ...(machinery ? { machinery } : {}) } as never));
  expect(JSON.stringify(await search())).not.toContain(toss.id);
  expect(JSON.stringify(await search("show"))).toContain(toss.id);

  const activity = async (machinery?: string) => (await client.request<{ entries: { block: Block }[] }>({ action: "activity.recent", author: "agent", limit: 20, ...(machinery ? { machinery } : {}) } as never)).entries.map(e => e.block.id);
  expect(await activity()).not.toContain(toss.id);
  expect(await activity("only")).toEqual([toss.id]);

  const feed = async (machinery?: string) => {
    const page = await client.request<ChangeFeedPage>({ action: "changes.since", sequence: 0, limit: 100, ...(machinery ? { machinery } : {}) } as never);
    return page.kind === "changes" ? [...new Set(page.changes.map(c => c.blockId).filter(id => id === gate.id || id === toss.id))] : [];
  };
  // The feed is how a client catches up, so it holds everything unless asked; each change says whether it is machinery.
  expect(await feed()).toEqual([gate.id, toss.id]);
  expect(await feed("hide")).toEqual([gate.id]);
  expect(await feed("only")).toEqual([toss.id]);
  expect(await feed("show")).toEqual([gate.id, toss.id]);
});

test("a saved view hides machinery unless its note says [machinery::show]", async () => {
  const { client, make } = await setup();
  const touch = await make("src/a.ts [type::file-touch] [machine::file-touch]", "agent");
  const hidden = await make("Touches [type::virtual-branch] [query::type=file-touch]");
  const shown = await make("Touches, all [type::virtual-branch] [query::type=file-touch] [machinery::show]");
  const members = async (view: Block) => (await client.request<{ blocks: Block[] }>({ action: "views.read", viewId: view.id, format: "tree" } as never)).blocks.map(b => b.id);
  expect(await members(hidden)).toEqual([]);
  expect(await members(shown)).toEqual([touch.id]);
  const only = await make("Only tools [type::virtual-branch] [query::type=file-touch] [machinery::only]");
  const ordinary = await make("A person wrote this [type::file-touch]");
  const plan = async (view: Block, input: Record<string, unknown>) => (await client.request<{ plans: { plan: { kind: string } }[] }>({ action: "views.planWrite", viewIds: [view.id], ...input } as never)).plans[0]!.plan;
  expect((await plan(only, { blockId: ordinary.id })).kind).toBe("refused");
  expect((await plan(hidden, { blockId: touch.id })).kind).toBe("refused");
  expect((await plan(only, { text: "A new touch" })).kind).toBe("refused");
  expect((await plan(shown, { blockId: touch.id })).kind).toBe("already");
});

test("an edit that moved only property tokens says bookkeeping; one that changed words does not", async () => {
  const { client, make } = await setup();
  const gate = await make("Mend the gate [work-stage::doing]");
  const stage = await client.request<Block>({ action: "update", blockId: gate.id, text: "Mend the gate [work-stage::review]", expectedRevision: gate.revision, mutation: { author: "agent", actorId: "loki" } } as never);
  await client.request<Block>({ action: "update", blockId: gate.id, text: "Mend the fence [work-stage::review]", expectedRevision: stage.revision, mutation: { author: "user" } } as never);
  const page = await client.request<ChangeFeedPage>({ action: "changes.since", sequence: 0, limit: 100 });
  if (page.kind !== "changes") throw new Error("expected changes");
  const edits = page.changes.filter(c => c.kind === "edit" && c.blockId === gate.id);
  expect(edits.map(c => c.bookkeeping ?? false)).toEqual([true, false]);
});

test("by: and revision ask who wrote a note last and how often it was saved, so what people wrote today is a query (PIE-867)", async () => {
  const { client, make } = await setup();
  const asked = async (where: string) => (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `${where} text~"orchard"`, limit: 50 } as never })).blocks.map(b => b.text.split(" [")[0]);
  const wall = await make("The orchard wall");
  await make("The orchard ledger [revision::100]");
  const agent = await make("The orchard map", "agent");
  const stamped = await make("The orchard touch [machine::file-touch]", "agent");
  await client.request<Block>({ action: "update", blockId: wall.id, text: "The orchard wall, mended", expectedRevision: wall.revision, mutation: { author: "user" } } as never);
  expect((await asked("by:user")).sort()).toEqual(["The orchard ledger", "The orchard wall, mended"]);
  expect((await asked("by:agent")).sort()).toEqual(["The orchard map"]);
  expect(await asked("by:agent NOT machine")).toEqual(["The orchard map"]);
  expect(await asked("revision >= 2")).toEqual(["The orchard wall, mended"]);
  expect(agent.id).not.toBe(stamped.id);
  const changed = await client.request<Block>({ action: "update", blockId: agent.id, text: "The orchard map, revised", expectedRevision: agent.revision, mutation: { author: "user" } } as never);
  expect((await asked("by:user")).sort()).toEqual(["The orchard ledger", "The orchard map, revised", "The orchard wall, mended"]);
  expect(await asked("by:agent")).toEqual([]);
  await client.request<Block>({ action: "update", blockId: changed.id, text: "The orchard map, by the gardener", expectedRevision: changed.revision, mutation: { author: "agent", actorId: "gardener" } } as never);
  expect(await asked("by:gardener")).toEqual(["The orchard map, by the gardener"]);
  // PIE-1605: a bare persona finds every id with that persona; a whole id finds only itself.
  const shed = await client.request<Block>({ action: "create", text: "The orchard shed key", author: "agent", provenance: { actorId: "gardener/cli@potting-shed" } } as never);
  const barn = await client.request<Block>({ action: "create", text: "The orchard barn key", author: "agent", provenance: { actorId: "gardener/claude-code@barn" } } as never);
  const pond = await client.request<Block>({ action: "create", text: "The orchard pond key", author: "agent", provenance: { actorId: "pruner/cli@potting-shed" } } as never);
  expect(pond.id).toBeDefined();
  expect((await asked("by:gardener")).sort()).toEqual(["The orchard barn key", "The orchard map, by the gardener", "The orchard shed key"]);
  expect((await asked("by:GARDENER")).sort()).toEqual(["The orchard barn key", "The orchard map, by the gardener", "The orchard shed key"]);
  expect(await asked("by:gardener/cli@potting-shed")).toEqual(["The orchard shed key"]);
  expect(await asked("by:gardener/cli@barn")).toEqual([]);
  expect(barn.id).not.toBe(shed.id);
  await expect(asked("by:")).rejects.toThrow("names no writer");
});

test("an agent's recent-activity find leaves fetched notifications out and says how many (PIE-1427)", async () => {
  const { client, make } = await setup();
  await make("Pruned the pear row [type::chore]");
  for (const i of [1, 2, 3]) await make(`Seed order ${i} shipped [notify.key::mail:${i}] [machine::notification]`, "agent");
  await make("Toss one [type::toss] [machine::echonet]", "agent");
  const found = await findBlocks(client as never, { query: "updated >= -1d", limit: 200 });
  const titles = found.blocks.map(b => b.title);
  expect(titles).toContain("Pruned the pear row");
  expect(titles.filter(t => t.startsWith("Seed order") || t.startsWith("Toss"))).toEqual([]);
  expect(found.machineryOmitted).toEqual({ count: 4, by: { notification: 3, echonet: 1 }, said: "4 notifications and bookkeeping notes left out (machinery: show brings them back)" });
  expect((await findBlocks(client as never, { query: "updated >= -1d", machinery: "show" })).machineryOmitted).toBeUndefined();
  expect((await findBlocks(client as never, { query: "type=chore" })).machineryOmitted).toBeUndefined();
});
