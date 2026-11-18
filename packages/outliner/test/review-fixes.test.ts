// What the branch's outside review found in the service and proved: each case here was red before its fix. Over a
// scratch service in a temp folder; every note is made up (a seed store's shelves).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListAnswer } from "@ep0ch/outline-core/list-row";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, BlockReadCollection } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-review-")));
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "seeds" });
  await server.start();
  const client = new OutlinerClient(socket, 60_000);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  return { client, create, store };
}

test("the notes under a note are read whole, however many there are, and none is an empty read", async () => {
  const { client, create, store } = await setup();
  const shelf = await create("Shelf");
  const leaf = await create("Empty tray");
  // More than one read of ids takes (1,000): a records page with thousands of rows under it is an ordinary note.
  for (let i = 0; i < 1001; i++) store.create(`Packet ${i}`, shelf.id, "user");
  const under = await client.request<BlockReadCollection>({ action: "blocks.read", under: shelf.id, fields: ["title"] } as never);
  expect(under.blocks.length).toBe(1001);
  const none = await client.request<BlockReadCollection>({ action: "blocks.read", under: leaf.id, fields: ["title"] } as never);
  expect(none.blocks).toEqual([]);

  // The tree over them: the folder unfolds (up to what a list holds, said), and a tree rooted at a leaf is empty.
  const tree = await client.request<ListAnswer>({ action: "lists.read", from: "children", open: [shelf.id] } as never);
  expect(tree.list.rows.find(r => r.id === shelf.id)?.open).toBe(true);
  expect(tree.list.rows.length).toBeGreaterThan(2);
  const bare = await client.request<ListAnswer>({ action: "lists.read", from: "children", of: leaf.id } as never);
  expect([bare.list.rows, bare.list.empty]).toEqual([[], "No notes yet."]);
});

test("a screen saved again keeps a comment made on its note", async () => {
  const { client } = await setup();
  const spec = { name: "seed-list", title: "Seed list", layout: { focus: "seeds", root: { t: "split", dir: "row", weights: [0.4, 0.6], kids: [{ t: "leaf", kind: "query", name: "seeds", query: "type=seed" }, { t: "leaf", kind: "reader", name: "reader" }] } } };
  const made = await client.request<{ id: string; revision: number }>({ action: "screens.save", spec, mutation: { author: "user" } } as never);
  const note = await client.request<Block>({ action: "get", blockId: made.id } as never);
  await client.request({ action: "annotations.batch", requestId: "comment-1", author: "agent", actorId: "tidy-agent", operations: [{ operationId: "1", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "The seeds column could be wider.", source: "agent" } }] } as never);
  const texts = async () => (await client.request<{ text: string }[]>({ action: "children", parentId: made.id } as never)).map(b => b.text.split("\n")[0]!.replace(/ \[.*$/, ""));
  const before = await texts();
  expect(before.length).toBe(2);
  const again = { ...spec, layout: { ...spec.layout, root: { ...spec.layout.root, weights: [0.5, 0.5] } } };
  await client.request({ action: "screens.save", spec: again, mutation: { author: "user" } } as never);
  const after = await client.request<{ text: string }[]>({ action: "children", parentId: made.id } as never);
  expect(after.length).toBe(2);
  expect(after.some(b => b.text.includes("The seeds column could be wider."))).toBe(true);
  expect(after.some(b => b.text.startsWith("split row [ratio::0.5]"))).toBe(true);
  // And the screen reads back as saved: the comment is no part of its layout.
  const listed = await client.request<{ screens: { name: string; spec?: unknown; problems: unknown[] }[] }>({ action: "screens.list" } as never);
  expect(listed.screens.find(s => s.name === "seed-list")?.spec).toEqual(again as never);
});

test("a watch whose answer takes a turn keeps the newest question, and none for a connection that went away", async () => {
  const { QueryWatches } = await import("../src/query-watches");
  const watches = new QueryWatches({ answer: r => ({ id: r.id, ok: true, result: {}, sequence: 1 }), sequence: () => 1 });
  cleanups.push(() => watches.stop());
  const lines: string[] = [];
  const connection = { write: (line: string) => lines.push(line) };
  // Two notes asked under one key, as a reader that moves on reuses its key: the first answers last.
  let first!: () => void, second!: () => void;
  const slow = new Promise<void>(done => { first = done; }), quick = new Promise<void>(done => { second = done; });
  const later = (gate: Promise<void>) => async (r: { id: string } & Record<string, unknown>) => { await gate; return { id: r.id, ok: true as const, result: { page: r.blockId }, sequence: 1 }; };
  const a = watches.askLater(connection, { id: "1", action: "notes.page", watch: "reader", blockId: "plot-a" }, later(slow) as never);
  const b = watches.askLater(connection, { id: "2", action: "notes.page", watch: "reader", blockId: "plot-b" }, later(quick) as never);
  second(); await b; first(); await a;
  expect(watches.size).toBe(1);
  // The question kept is the newest: asked again it is answered from what is held, and the older one is not.
  let asked = 0;
  const count = async (r: { id: string }) => { asked += 1; return { id: r.id, ok: true as const, result: {}, sequence: 1 }; };
  await watches.askLater(connection, { id: "3", action: "notes.page", watch: "reader", blockId: "plot-b" }, count as never);
  expect(asked).toBe(0);

  // A connection that closes while its answer is on the way leaves no watch behind.
  let land!: () => void;
  const gone = { write: () => {} };
  const pending = watches.askLater(gone, { id: "4", action: "notes.page", watch: "reader", blockId: "plot-c" }, later(new Promise<void>(done => { land = done; })) as never);
  watches.closed(gone);
  land(); await pending;
  expect(watches.size).toBe(1);
});
