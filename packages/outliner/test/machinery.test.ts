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
import { backfill } from "../src/machinery-backfill";
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
  // The service's own Extensions pages are machinery too (PIE-1427): only the two notes here are asked about.
  expect((await activity("only")).filter(id => id === toss.id || id === gate.id)).toEqual([toss.id]);

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
  await expect(asked("by:")).rejects.toThrow("names no writer");
});

test("the backfill stamps what tools wrote before they stamped, says so first, and leaves a stamped note alone", async () => {
  const { client, make } = await setup();
  const toss = await make("Toss 2026-03-02 09:30 UTC [type::toss] [node::kitchen@box-b]", "agent");
  await make("Nodelist [type::nodelist] [machine::echonet]", "agent");
  const touch = await make("src/a.ts [type::file-touch] [file::/w/src/a.ts]", "agent");
  const view = await make("By project [type::virtual-branch] [query::type=file-touch] [file-project-view::garden]");
  const person = await make("Mend the gate [type::chore]");
  // The notifications hub's notes and boards from before it stamped (PIE-1427); a view over chores stays as it is.
  const ping = await make("Seed order shipped [notify.key::mail:7] [notify.source::mail] [notify.state::unread]", "agent");
  const lane = await make("Unread [type::virtual-branch] [query::notify.state=unread]");
  const chores = await make("Chores [type::virtual-branch] [query::type=chore]");
  const dry = await backfill(client as never, false);
  expect(dry.find(r => r.producer === "echonet")?.stamped).toBe(1);
  expect(dry.find(r => r.producer === "file-touch")?.stamped).toBe(1);
  expect(dry.find(r => r.producer === "file-touch views")?.stamped).toBe(1);
  const still = (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "type=toss", machinery: "show" } as never })).blocks[0]!;
  expect(still.properties.some(p => p.key === "machine")).toBe(false);
  const done = await backfill(client as never, true);
  expect(done.find(r => r.producer === "echonet")?.stamped).toBe(1);
  const after = async (id: string) => (await client.request<Block>({ action: "get", blockId: id } as never));
  expect((await after(toss.id)).properties.find(p => p.key === "machine")?.value).toBe("echonet");
  expect((await after(touch.id)).properties.find(p => p.key === "machine")?.value).toBe("file-touch");
  expect((await after(view.id)).properties.find(p => p.key === "machinery")?.value).toBe("show");
  expect((await after(person.id)).properties.some(p => p.key === "machine")).toBe(false);
  expect((await after(ping.id)).properties.find(p => p.key === "machine")?.value).toBe("notification");
  expect((await after(lane.id)).properties.find(p => p.key === "machinery")?.value).toBe("show");
  expect((await after(chores.id)).properties.some(p => p.key === "machinery")).toBe(false);
  expect((await backfill(client as never, true)).every(r => r.stamped === 0)).toBe(true);
  const hidden = (await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "type=toss OR type=file-touch OR type=chore", limit: 20 } as never })).blocks.map(b => b.id);
  expect(hidden).toEqual([person.id]);
});

// PIE-1427, seen in use (Oct 29): the Extensions hub, every extension's page and the notifications hub's boards came
// back as real work in a chat's recent-activity read, because they carried no [machine::].
test("the notifications hub's pull page is stamped by the backfill, by who wrote it last; its demo boards stay the person's", async () => {
  const { client, store } = await setup();
  // Written as the service writes them (an extension's actor id is the service's alone).
  const as = (actorId: string, text: string, parent: string | null = null) => store.create(text, parent, "agent", { actorId });
  const pulled = as("ext:notify", "Notifications [page::notifications]");
  as("ext:notify", "Heron survey merged [notify.key::github:7] [machine::notification]", pulled.id);
  const board = as("ext:notify", "Notifications by source [page::notifications-source]");
  const lane = as("ext:notify", "Jira [type::virtual-branch] [query::notify.source=jira] [machinery::show]", board.id);
  const theirs = as("ext:notify", "Notifications, mine [page::notifications-mine]");
  as("ext:notify", "Heron survey closed [notify.key::github:8] [machine::notification]", theirs.id);
  await client.request({ action: "update", blockId: theirs.id, expectedRevision: theirs.revision, text: `${theirs.text}\n\nMine now.` } as never);
  const done = await backfill(client as never, true);
  expect(done.find(r => r.producer === "notify")?.stamped).toBe(1);
  const machine = async (id: string) => (await client.request<Block>({ action: "get", blockId: id } as never)).properties.find(p => p.key === "machine")?.value;
  expect(await Promise.all([pulled, board, lane, theirs].map(b => machine(b.id)))).toEqual(["notify", undefined, undefined, undefined]);
  // Stamped, a page still opens by its address.
  expect((await client.request<{ status: string; block?: Block }>({ action: "pages.resolve", address: "notifications" } as never)).block?.id).toBe(pulled.id);
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
  // The Extensions hub and its pages the service wrote at start are left out too, and counted (PIE-1427).
  const pages = found.machineryOmitted?.by["extension-page"] ?? 0;
  expect(pages).toBeGreaterThan(0);
  expect(found.machineryOmitted).toEqual({ count: 4 + pages, by: { notification: 3, echonet: 1, "extension-page": pages }, said: `${4 + pages} notifications and bookkeeping notes left out (machinery: show brings them back)` });
  expect((await findBlocks(client as never, { query: "updated >= -1d", machinery: "show" })).machineryOmitted).toBeUndefined();
  expect((await findBlocks(client as never, { query: "type=chore" })).machineryOmitted).toBeUndefined();
});
