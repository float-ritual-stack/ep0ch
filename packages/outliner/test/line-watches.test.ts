// One owner for the questions a note's lines watch (PIE-1463, PIE-1467): a render script's `q()` and a query-fed
// handler's manifest `query` both end in the service's one QueryWatches, and a figure stays live and says what changed.
// A scratch service in a temp folder; every note and name is made up.
import { expect, test } from "bun:test";
import { setup, until } from "./script-harness";

const PERSON = { author: "user" as const };

async function lab() {
  const h = await setup();
  await h.client.request({ action: "extensions.install", extension: "workbench" });
  const watched = () => h.server.watches.size;
  /** What a reader sees of a note's lines: a script's markdown, a component's projection, or the error that replaced it. */
  const shown = async (id: string) => JSON.stringify([h.output(id), (await h.client.request<{ projections: unknown[] }>({ action: "resources.projection.read", blockId: id })).projections]);
  const redrawn = (id: string, holds: string) => until(`${holds} in the drawing`, async () => (await shown(id)).includes(holds));
  return { ...h, watched, redrawn, shown };
}

test("a drawing that counts what its unlimited query matched redraws when an unlisted match appears or goes", async () => {
  const { create, store, draw, redrawn, client } = await lab();
  for (let i = 0; i < 24; i++) create(`Pot ${i} [type::line-pot]`);
  const board = create('Count\n::= "pots " + (await query({ where: "type=line-pot", limit: 20, group: "type" })).groups[0].count');
  await draw(board.id);
  await redrawn(board.id, "pots 24");
  // The 25th match is past the 20 the drawing lists: nothing it listed changed, yet its count did.
  const extra = create("Pot 24 [type::line-pot]");
  await redrawn(board.id, "pots 25");
  await client.request({ action: "delete", blockId: extra.id });
  await redrawn(board.id, "pots 24");
  expect(store.require(board.id).text).toContain("pots");
}, 60_000);

test("trashing a note drops the watches of the lines under it, and restoring it watches again", async () => {
  const { create, store, client, draw, watched, redrawn } = await lab();
  create("Pea [type::line-seed] [stage::ready]");
  const parent = create("Shelf");
  const board = create("Seeds [type::virtual-branch] [query::type=line-seed]\nworkbench::", parent.id);
  await draw(board.id);
  await redrawn(board.id, "Pea");
  const before = watched();
  expect(before).toBeGreaterThan(0);
  await client.request({ action: "delete", blockId: parent.id });
  await until("the trashed line's watch gone", () => watched() < before);
  await client.request({ action: "trash.restore", blockId: parent.id });
  await until("the restored line watched again", () => watched() === before);
  expect(store.get(board.id)!.effectiveDeletedRootId).toBeFalsy();
}, 60_000);

test("removing a workbench's query says why, and putting it back draws it live again", async () => {
  const { create, store, client, draw, redrawn, shown, watched } = await lab();
  create("Pea [type::line-seed]");
  const board = create("Seeds [type::virtual-branch] [query::type=line-seed]\nworkbench::");
  await draw(board.id);
  await redrawn(board.id, "Pea");
  const withQuery = store.require(board.id);
  const without = await client.request<{ revision: number }>({ action: "update", blockId: board.id, expectedRevision: withQuery.revision, text: "Seeds [type::virtual-branch]\nworkbench::", mutation: PERSON });
  await until("the reason", async () => !(await shown(board.id)).includes('"status":"ready"'));
  // A question that no longer binds watches nothing: the old one is released, not kept dormant.
  expect(watched()).toBe(0);
  await client.request({ action: "update", blockId: board.id, expectedRevision: without.revision, text: withQuery.text, mutation: PERSON });
  await redrawn(board.id, "Pea");
  create("Bean [type::line-seed]");
  await redrawn(board.id, "Bean");
}, 60_000);

test("a watch the service drops at its cap says so on the figure instead of going quiet", async () => {
  const { create, server, draw, redrawn, shown } = await lab();
  create("Pea [type::line-seed]");
  const board = create("Seeds [type::virtual-branch] [query::type=line-seed]\nworkbench::");
  await draw(board.id);
  await redrawn(board.id, "Pea");
  // Past the service's cap the oldest watch goes; the figure it fed is told, not left showing a stale answer as live.
  for (let i = 0; i < 520; i++) server.watches.ask({ write: () => {} }, { id: "x", action: "blocks.query", watch: "crowd", query: { where: `type=line-${i}` } } as never);
  await until("the figure says its watch was dropped", async () => /live updates (paused|stopped)/.test(await shown(board.id)));
}, 60_000);

const FEWER = '::= (async () => { const a = await q("type=lw-a"); let out = "a" + a.blocks.length; if (a.blocks.length > 1) out += " b" + (await q("type=lw-b")).blocks.length; return out; })()';

test("a script that asks fewer questions keeps watching the one it still asks", async () => {
  const { create, store, draw, redrawn, client } = await lab();
  const [first] = [create("A1 [type::lw-a]"), create("A2 [type::lw-a]"), create("B1 [type::lw-b]")];
  const board = create(`Fewer\n${FEWER}`);
  await draw(board.id);
  await redrawn(board.id, "a2 b1");
  await client.request({ action: "delete", blockId: first.id });
  await redrawn(board.id, '"markdown":"a1"');
  create("A3 [type::lw-a]");
  await redrawn(board.id, "a2 b1");
  expect(store.get(board.id)).toBeTruthy();
}, 60_000);

test("restoring a note watches the figures under it even past two hundred tagged notes", async () => {
  const { create, client, draw, redrawn, watched } = await lab();
  create("Pea [type::lw-seed]");
  const parent = create("Shelf");
  for (let i = 0; i < 205; i++) create(`Tag ${i} [kind::lw-tag]`, parent.id);
  const board = create("Seeds [type::virtual-branch] [query::type=lw-seed]\nworkbench::", parent.id);
  await draw(board.id);
  await redrawn(board.id, "Pea");
  const before = watched();
  await client.request({ action: "delete", blockId: parent.id });
  await until("released", () => watched() < before);
  await client.request({ action: "trash.restore", blockId: parent.id });
  await until("watched again", () => watched() === before);
}, 60_000);

test("a script line whose watch the service drops keeps what it read, so a reader cut still applies", async () => {
  const { create, store, server, draw, redrawn, shown } = await lab();
  create("Pea [type::lw-seed]");
  const board = create('Seeds\n::= "peas " + (await q("type=lw-seed")).blocks.length');
  await draw(board.id);
  await redrawn(board.id, "peas 1");
  const readBefore = (store.extensionOutputs(board.id)[0]!.request as { reads: unknown[] }).reads.length;
  for (let i = 0; i < 520; i++) server.watches.ask({ write: () => {} }, { id: "x", action: "blocks.query", watch: "crowd", query: { where: `type=lw-crowd-${i}` } } as never);
  await until("the line says so", async () => /live updates paused/.test(await shown(board.id)));
  expect((store.extensionOutputs(board.id)[0]!.request as { reads: unknown[] }).reads.length).toBe(readBefore);
}, 60_000);
