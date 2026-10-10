// An action's writes are one group (PIE-784): blocks it makes are named and linked in the same answer, moves and a
// children's order go with them, all in one transaction or none, one proposal while a door holds a draft of a part,
// and one undo step after. Declared arguments are checked and filled in. Scratch services in temp folders; every
// note and name is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLocated, locateSpans } from "@ep0ch/outline-core/draft-patch-compare";
import { OutlinerClient } from "../src/client";
import type { ExtensionsListResult } from "../src/extension-registry";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, OutlinerEvent } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Writes what `args.writes` says (JSON), and says back the args it was given. */
const GROUPER = `const { input } = await Bun.stdin.json();
const say = (value) => process.stdout.write(JSON.stringify({ ok: true, value }));
say({ message: JSON.stringify(input.args ?? {}), ...(input.args?.writes ? { writes: JSON.parse(input.args.writes) } : {}) });`;

type Act = { written: string[]; message?: string; proposalId?: string; undo?: string };

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-write-groups-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  const folder = join(outline, "extensions", "grouper");
  mkdirSync(folder, { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  const client = new OutlinerClient(socket, 15_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  writeFileSync(join(folder, "extension.json"), JSON.stringify({
    contract: 2, id: "grouper", version: 1, name: "Grouper", run: ["bun", "main.ts"],
    actions: [
      { id: "write", label: "write", effects: "write" },
      { id: "sort", label: "sort", effects: "write", args: [
        { name: "by", type: "property", options: ["title"], from: "children", required: true, defaultProperty: "sort-by" },
        { name: "order", type: "choice", options: ["asc", "desc"], default: "asc" },
      ] },
    ],
  }));
  writeFileSync(join(folder, "main.ts"), GROUPER);
  await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const act = (action: string, blockId: string, args: Record<string, string> = {}) =>
    client.request<Act>({ action: "extensions.act", extension: "grouper", extensionAction: action, blockId, args, mutation: { author: "user" } });
  const write = (blockId: string, writes: unknown[]) => act("write", blockId, { writes: JSON.stringify(writes) });
  const note = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const live = (parentId: string) => store.children(parentId).filter((child) => !child.effectiveDeletedRootId);
  return { store, client, act, write, note, live };
}

/** A stand-in door holding a draft of `block`, applying what it's asked to. */
async function holdingDoor(client: OutlinerClient, block: Block, clientId: string) {
  const door = { text: block.text };
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({
    client: { clientId, role: "observer", contextId: clientId }, onConnect: connected.resolve,
    onEvent: async (event: OutlinerEvent) => {
      const ask = event.domain === "draft" ? event.draft : undefined;
      if (!ask) return;
      let answer: unknown = { applied: false, reason: "unexpected" };
      if (ask.kind === "read") answer = { text: door.text, revision: block.revision };
      else if (ask.kind === "patch") {
        const located = locateSpans(door.text, ask.patches, ask.force);
        if (located.ok) { door.text = applyLocated(door.text, located.spans); answer = { applied: true }; }
        else answer = { applied: false, reason: located.reason };
      }
      await client.request({ action: "drafts.answer", requestId: ask.requestId, clientId, answer: answer as never }).catch(() => undefined);
    },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  const held = await client.request<{ holdId: string }>({ action: "drafts.hold", blockId: block.id, clientId, revision: block.revision });
  return Object.assign(door, { holdId: held.holdId });
}

test("a block made in the group is named, linked from the note's edit, and both land as one step that undo takes back", async () => {
  const { store, write, note, live, client } = await setup();
  const garden = await note("Garden\nSow the beans in May.\nWater at dusk.");
  const done = await write(garden.id, [
    { op: "create", parentId: garden.id, text: "Sow the beans in May.", as: "c1" },
    { op: "update", blockId: garden.id, expectedRevision: garden.revision, text: "Garden\n!((c1))\nWater at dusk." },
  ]);
  const [child] = live(garden.id);
  expect(child!.text).toBe("Sow the beans in May.");
  expect(child!.actorId).toBe("ext:grouper");
  expect(store.get(garden.id)!.text).toBe(`Garden\n!((${child!.id}))\nWater at dusk.`);
  expect(done.written.sort()).toEqual([garden.id, child!.id].sort());
  expect(done.undo).toBeString();

  const undone = await client.request<{ written: string[] }>({ action: "extensions.undo", undo: done.undo!, mutation: { author: "user" } });
  expect(undone.written.sort()).toEqual([garden.id, child!.id].sort());
  expect(store.get(garden.id)!.text).toBe("Garden\nSow the beans in May.\nWater at dusk.");
  expect(live(garden.id)).toEqual([]);
  // Once: a second undo of it is refused.
  await expect(client.request({ action: "extensions.undo", undo: done.undo!, mutation: { author: "user" } })).rejects.toThrow(/No extension change/);
});

test("one write that can't land writes none of the group: no block is made", async () => {
  const { store, write, note, live } = await setup();
  const garden = await note("Garden\nSow the beans in May.");
  await expect(write(garden.id, [
    { op: "create", parentId: garden.id, text: "Sow the beans in May.", as: "c1" },
    { op: "update", blockId: garden.id, expectedRevision: garden.revision + 1, text: "Garden\n!((c1))" },
  ])).rejects.toThrow(/nothing was written/);
  // A name used before the write that makes it is said as such.
  await expect(write(garden.id, [
    { op: "update", blockId: garden.id, expectedRevision: garden.revision, text: "Garden\n!((c1))" },
    { op: "create", parentId: garden.id, text: "Sow", as: "c1" },
  ])).rejects.toThrow(/names c1 before the write that makes it/);
  // The order's children don't match the block's now (one is missing): the move before it is taken back too.
  const a = await note("Apples", garden.id), b = await note("Beans", garden.id), shed = await note("Shed");
  await expect(write(garden.id, [
    { op: "move", blockId: a.id, parentId: shed.id, expectedRevision: a.revision },
    { op: "order", parentId: garden.id, children: [a.id, b.id] },
  ])).rejects.toThrow(/exactly the children/);
  expect(store.get(a.id)!.parentId).toBe(garden.id);
  expect(store.get(garden.id)!.text).toBe("Garden\nSow the beans in May.");
  expect(live(garden.id).map((child) => child.text)).toEqual(["Apples", "Beans"]);
});

test("an order puts the children in place in one step, and undo puts them back", async () => {
  const { store, write, note, live, client } = await setup();
  const list = await note("Seeds");
  for (const name of ["Squash", "Beans", "Kale"]) await note(name, list.id);
  const ids = live(list.id).map((child) => child.id);
  const done = await write(list.id, [{ op: "order", parentId: list.id, children: [ids[1], ids[2], ids[0]] }]);
  expect(live(list.id).map((child) => child.text)).toEqual(["Beans", "Kale", "Squash"]);
  const moves = store.changes.since(0, 1000);
  expect(moves.kind === "changes" && moves.changes.filter((change) => change.kind === "move" && change.actor?.actorId === "ext:grouper").length).toBe(3);
  // Moved again since (a person's move within the same parent): undo is refused rather than undo that too.
  await client.request({ action: "move", blockId: ids[0], parentId: list.id, position: 0, mutation: { author: "user" } });
  await expect(client.request({ action: "extensions.undo", undo: done.undo!, mutation: { author: "user" } })).rejects.toThrow(/changed since; nothing was undone/);
  await client.request({ action: "move", blockId: ids[0], parentId: list.id, position: 2, mutation: { author: "user" } });
  await client.request({ action: "extensions.undo", undo: done.undo!, mutation: { author: "user" } });
  expect(live(list.id).map((child) => child.text)).toEqual(["Squash", "Beans", "Kale"]);
});

test("an order while a door holds a child's draft waits as a proposal under the parent, and applies with the proposal there", async () => {
  const { store, write, note, live, client } = await setup();
  const list = await note("Seeds");
  for (const name of ["Squash", "Beans"]) await note(name, list.id);
  const [squash, beans] = live(list.id);
  await holdingDoor(client, squash!, "door-order");
  const done = await write(list.id, [{ op: "order", parentId: list.id, children: [beans!.id, squash!.id] }]);
  expect(done.proposalId).toBeString();
  expect(store.get(done.proposalId!)!.text).toContain(`((${beans!.id}|Beans)), ((${squash!.id}|Squash))`);
  await client.request({ action: "draft.proposal.apply", proposalId: done.proposalId!, mutation: { author: "user" } });
  expect(live(list.id).filter((child) => child.id !== done.proposalId).map((child) => child.text)).toEqual(["Beans", "Squash"]);
});

test("undo is refused, with nothing changed, when something it wrote changed since", async () => {
  const { store, write, note, live, client } = await setup();
  const garden = await note("Garden\nSow the beans.");
  const done = await write(garden.id, [
    { op: "create", parentId: garden.id, text: "Sow the beans.", as: "c1" },
    { op: "update", blockId: garden.id, expectedRevision: garden.revision, text: "Garden\n!((c1))" },
  ]);
  const now = store.get(garden.id)!;
  await client.request({ action: "update", blockId: garden.id, expectedRevision: now.revision, text: `${now.text}\nand peas`, mutation: { author: "user" } });
  await expect(client.request({ action: "extensions.undo", undo: done.undo!, mutation: { author: "user" } })).rejects.toThrow(/changed since; nothing was undone/);
  expect(live(garden.id)).toHaveLength(1);
});

test("a door holding a draft of a block the group edits makes the whole group one proposal; applied, all of it lands", async () => {
  const { store, write, note, live, client } = await setup();
  const garden = await note("Garden\nSow the beans in May.");
  const door = await holdingDoor(client, garden, "door-groups");
  const done = await write(garden.id, [
    { op: "create", parentId: garden.id, text: "Sow the beans in May.", as: "c1" },
    { op: "update", blockId: garden.id, expectedRevision: garden.revision, text: "Garden\n!((c1))" },
  ]);
  expect(done.written).toEqual([]);
  expect(done.message).toMatch(/^proposed instead: .*open in a draft.*its new block wasn't written$/);
  expect(live(garden.id).map((child) => child.id)).toEqual([done.proposalId!]);
  expect(door.text).toBe("Garden\nSow the beans in May.");
  // The proposal shows the new block's text and the edit; the person applies it anyway: all of it lands, the edit in the draft.
  expect(store.get(done.proposalId!)!.text).toContain(`a new block under ((${garden.id}|Garden)):`);
  await client.request({ action: "draft.proposal.apply", proposalId: done.proposalId!, mutation: { author: "user" } });
  const made = live(garden.id).find((child) => child.id !== done.proposalId)!;
  expect(made.text).toBe("Sow the beans in May.");
  expect(door.text).toBe(`Garden\n!((${made.id}))`);
});

test("declared arguments: checked, filled in from the block's own property or their default, and listed with their choices", async () => {
  const { act, note, client } = await setup();
  const seeds = await note("Seeds");
  await note("Kale [price::3]", seeds.id);
  await note("Beans [price::2] [days::60]", seeds.id);
  await expect(act("sort", seeds.id)).rejects.toThrow(/needs by=: title, price, days/);
  await expect(act("sort", seeds.id, { by: "price", order: "sideways" })).rejects.toThrow(/order=sideways isn't one of asc, desc/);
  expect(JSON.parse((await act("sort", seeds.id, { by: "price" })).message!)).toEqual({ by: "price", order: "asc" });
  // Undeclared arguments pass as they are.
  expect(JSON.parse((await act("sort", seeds.id, { by: "title", list: "2" })).message!)).toEqual({ by: "title", order: "asc", list: "2" });
  const own = await note("Bulbs [sort-by::days]");
  expect(JSON.parse((await act("sort", own.id)).message!)).toEqual({ by: "days", order: "asc" });
  const asked = await client.request<{ args: Array<{ name: string; choices?: string[]; value?: string }> }>({ action: "extensions.args", extension: "grouper", extensionAction: "sort", blockId: seeds.id });
  expect(asked.args.map((arg) => [arg.name, arg.choices, arg.value])).toEqual([["by", ["title", "price", "days"], undefined], ["order", ["asc", "desc"], "asc"]]);
});

test("undo is refused, with nothing changed, when a block it made has a proposal waiting under it", async () => {
  const { store, write, note, live, client } = await setup();
  const garden = await note("Garden");
  const done = await write(garden.id, [{ op: "create", parentId: garden.id, text: "Beds\nSow the beans.", as: "c1" }]);
  const [beds] = live(garden.id);
  // A door holds the new block's draft.
  const door = await holdingDoor(client, beds!, "door-beds");
  // A group that makes a block and edits the held one waits whole, as one proposal under it.
  const edit = await write(beds!.id, [{ op: "create", parentId: beds!.id, text: "Peas" }, { op: "update", blockId: beds!.id, expectedRevision: beds!.revision, text: "Beds\nSow the beans and peas." }]);
  expect(store.get(edit.proposalId!)!.parentId).toBe(beds!.id);
  expect(live(beds!.id).some((child) => child.properties.some((p) => p.key === "type" && p.value === "draft-proposal"))).toBe(true);
  // The door lets go of the draft; the proposal still waits.
  await client.request({ action: "drafts.release", holdId: door.holdId });
  await expect(client.request({ action: "extensions.undo", undo: done.undo!, mutation: { author: "user" } })).rejects.toThrow(/has a proposal waiting under it; apply or dismiss it, then undo/);
  expect(store.get(beds!.id)!.effectiveDeletedRootId).toBeFalsy();
});
