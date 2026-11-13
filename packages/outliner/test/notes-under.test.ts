// "Does this note have notes under it" has one answer, the reading `isNoteUnder` (outline-core) gives the rows: a
// comment on a note, a reply in its thread and an edit proposed beside it are blocks under it and no notes of it. The
// service says it on the row (`blocks.read`'s `hasNotes`), and every list that leaves those blocks out draws its fold
// from it: a caret that opens onto nothing is the bug this file holds off. Over a scratch service in a temp folder;
// every note is made up (a garden's beds).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListAnswer } from "@ep0ch/outline-core/list-row";
import type { NotePage } from "@ep0ch/outline-core/note-page";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, ProjectedBlockCollection } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const TIDY = { author: "agent", actorId: "tidy-agent" };

/**
 * The garden: five beds under one note. One has nothing under it, one only a comment (with a reply in its thread),
 * one only a proposed edit, one both, and one a real note among a comment and a proposal.
 */
async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-notes-under-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 20_000);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  let asked = 0;
  const comment = async (on: Block, body: string) => {
    const made = await client.request<{ annotations: { block: { id: string } }[] }>({ action: "annotations.batch", requestId: `comment-${++asked}`, author: "user", operations: [{ operationId: "1", type: "block-comment", input: { blockId: on.id, expectedRevision: on.revision, body, source: "user" } }] } as never);
    return made.annotations[0]!.block.id;
  };
  const propose = async (on: Block, observed: string, replacement: string) => {
    const proposed = await client.request<{ outcome: string }>({ action: "draft.patch", propose: true, blockId: on.id, revision: on.revision, patches: [{ observed, replacement }], mutation: TIDY } as never);
    expect(proposed.outcome).toBe("proposed");
  };
  const beds = await create("Beds");
  const bare = await create("Herb spiral [type::bed]", beds.id);
  const commented = await create("North bed [type::bed]", beds.id);
  const thread = await comment(commented, "Too early for peas?");
  await client.request({ action: "annotations.reply", requestId: "reply-1", author: "agent", provenance: { actorId: TIDY.actorId }, input: { annotationId: thread, body: "The log says the last frost was May 19.", source: "agent" } } as never);
  const proposed = await create("South bed [type::bed]", beds.id);
  await propose(proposed, "South bed", "South bed, by the wall");
  const both = await create("East bed [type::bed]", beds.id);
  await comment(both, "Shade from the plum by noon.");
  await propose(both, "East bed", "East bed, under the plum");
  const parent = await create("West bed [type::bed]", beds.id);
  await comment(parent, "Leeks again?");
  const row = await create("First row", parent.id);
  await propose(parent, "West bed", "West bed, by the gate");
  const list = (from: string, more: Record<string, unknown> = {}) => client.request<ListAnswer>({ action: "lists.read", from, ...more } as never);
  const page = (blockId: string) => client.request<NotePage>({ action: "notes.page", blockId } as never);
  return { client, store, create, list, page, beds, bare, commented, proposed, both, parent, row };
}

test("blocks.read says whether a note has notes under it (hasNotes), beside whether it has any block under it", async () => {
  const { client, store, beds, bare, commented, proposed, both, parent, row } = await setup();
  const ids = [bare.id, commented.id, proposed.id, both.id, parent.id, beds.id];
  const read = await client.request<ProjectedBlockCollection>({ action: "blocks.read", ids, fields: ["title", "hasChildren", "hasNotes"] } as never);
  expect(read.blocks.map(b => [b.title, b.hasChildren, b.hasNotes])).toEqual([
    ["Herb spiral", false, false],
    ["North bed", true, false],
    ["South bed", true, false],
    ["East bed", true, false],
    ["West bed", true, true],
    ["Beds", true, true],
  ]);
  // The same answer on a level asked by its parent, and on a question's matches.
  const under = await client.request<ProjectedBlockCollection>({ action: "blocks.read", under: beds.id, fields: ["title", "hasNotes"] } as never);
  expect(under.blocks.map(b => [b.title, b.hasNotes])).toEqual([["Herb spiral", false], ["North bed", false], ["South bed", false], ["East bed", false], ["West bed", true]]);
  const matched = await client.request<ProjectedBlockCollection>({ action: "blocks.query", query: { where: "type=bed", limit: 20 }, fields: ["title", "hasNotes"] } as never);
  expect(Object.fromEntries(matched.blocks.map(b => [b.title, b.hasNotes]))).toEqual({ "Herb spiral": false, "North bed": false, "South bed": false, "East bed": false, "West bed": true });
  // Asked only by name: a read that names no fields answers what it did, and pays for no second look.
  expect((await client.request<ProjectedBlockCollection>({ action: "blocks.read", ids: [parent.id] })).blocks[0]).not.toHaveProperty("hasNotes");
  // Its one note binned, the bed has none; brought back, it has one again.
  store.delete(row.id);
  const binned = await client.request<ProjectedBlockCollection>({ action: "blocks.read", ids: [parent.id], fields: ["hasChildren", "hasNotes"] } as never);
  expect([binned.blocks[0]!.hasChildren, binned.blocks[0]!.hasNotes]).toEqual([true, false]);
});

const SYSTEM = new Set(["Workspace", "Trash", "Inbox", "Bookmarks", "Note mover"]);
const shape = (answer: ListAnswer) => answer.list.rows.filter(r => !SYSTEM.has(r.label)).map(r => [r.label, r.depth ?? 0, r.folds ?? false, r.open ?? false]);

test("the tree folds only a note that has notes under it: one with only comments, only proposals or both has no fold", async () => {
  const { list, beds, commented, proposed, both, parent } = await setup();
  const open = [beds.id, commented.id, proposed.id, both.id, parent.id];
  const tree = await list("children", { open });
  expect(shape(tree)).toEqual([
    ["Beds", 0, true, true],
    ["Herb spiral", 1, false, false],
    ["North bed", 1, false, false],
    ["South bed", 1, false, false],
    ["East bed", 1, false, false],
    ["West bed", 1, true, true],
    ["First row", 2, false, false],
  ]);
  // A fold that is open lists its notes; a note asked open that has none is no folder, and is not answered as one.
  expect([...tree.open!].sort()).toEqual([beds.id, parent.id].sort());
  expect(tree.list.rows.find(r => r.id === parent.id)!.kids).toBe(1);
  // Every row that folds opens onto at least one row, whatever is open.
  const folded = await list("children", { open: [beds.id] });
  for (const row of folded.list.rows.filter(r => r.folds)) {
    const under = await list("children", { of: row.id });
    expect([row.label, under.list.rows.length > 0]).toEqual([row.label, true]);
  }
});

test("a question's matches and a note's page say the same of each row: folds, and the page's rows, read notes only", async () => {
  const { list, page, beds, parent, row } = await setup();
  const matches = await list("query", { query: "type=bed" });
  expect(Object.fromEntries(matches.list.rows.map(r => [r.label, r.folds ?? false]))).toEqual({ "Herb spiral": false, "North bed": false, "South bed": false, "East bed": false, "West bed": true });
  const p = await page(beds.id);
  expect(p.children.map(c => [c.title, c.hasChildren ?? false])).toEqual([["Herb spiral", false], ["North bed", false], ["South bed", false], ["East bed", false], ["West bed", true]]);
  expect(p.under!.rows.map(r => [r.label, r.folds ?? false])).toEqual([["Herb spiral", false], ["North bed", false], ["South bed", false], ["East bed", false], ["West bed", true]]);
  // The notes above a note have it under them, so each says so.
  expect((await page(row.id)).ancestors.map(a => [a.title, a.hasChildren ?? false])).toEqual([["Beds", true], ["West bed", true]]);
  expect((await page(parent.id)).children).toEqual([{ id: row.id, title: "First row" }]);
});
