// The structure extension: extract a passage into a child, sort a list in a block, sort a block's children. A scratch
// service in a temp folder; every note and name is made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { extractFrom, sortListInText, sortSpec } from "../extensions/structure/lists";

const LOKI = { author: "agent" as const, actorId: "loki-test" };
const PERSON = { author: "user" as const };
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-structure-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  mkdirSync(join(outline, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "structure"), join(outline, "extensions", "structure"), { recursive: true });
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const server = new OutlinerServer(store, join(root, "outliner.sock"), undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state"), scheduleTickMs: 3_600_000 });
  server.setOutline({ name: "garden-scratch" });
  await server.start();
  const client = new OutlinerClient(join(root, "outliner.sock"), 60_000);
  cleanups.push(async () => {
    await server.close(); store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  await client.request({ action: "extensions.list", reload: true });
  const create = (text: string, parentId?: string) => client.request<Block>({ action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const get = (id: string) => client.request<Block>({ action: "get", blockId: id });
  const kids = (id: string) => client.request<Block[]>({ action: "children", parentId: id });
  const act = (extensionAction: string, blockId: string, o: { quote?: string; args?: Record<string, string>; mutation?: any } = {}) =>
    client.request<{ message?: string }>({
      action: "extensions.act", extension: "structure", extensionAction, blockId, mutation: o.mutation ?? PERSON,
      ...(o.args ? { args: o.args } : {}),
      ...(o.quote ? { passage: undefined } : {}),
    });
  return { client, create, get, kids, act, root };
}

/** An action on a passage, the way an agent asks: block + quote through the passage target. */
async function onPassage(client: OutlinerClient, action: string, created: Block, quote: string, mutation: any = PERSON, args?: Record<string, string>) {
  const block = await client.request<Block>({ action: "get", blockId: created.id });
  const start = block.text.indexOf(quote);
  const passage = { subject: block.id, revision: block.revision, quote, start, end: start + quote.length, prefix: block.text.slice(Math.max(0, start - 32), start), suffix: block.text.slice(start + quote.length, start + quote.length + 32) };
  return client.request<{ message?: string }>({ action: "extensions.act", extension: "structure", extensionAction: action, blockId: block.id, passage, mutation, ...(args ? { args } : {}) });
}

test("the pure parts: sort a list by title and by a property, extract a list item", () => {
  const text = "Seeds\n- b [price::3.5]\n  - sub\n- a [price::12]\n- c\n\nafter";
  expect(sortListInText(text, sortSpec(undefined)).text).toBe("Seeds\n- a [price::12]\n- b [price::3.5]\n  - sub\n- c\n\nafter");
  expect(sortListInText(text, sortSpec({ by: "price", order: "desc" })).text).toBe("Seeds\n- a [price::12]\n- b [price::3.5]\n  - sub\n- c\n\nafter");
  expect(() => sortListInText(text, sortSpec({ by: "cost" }))).toThrow("the items have price");
  const item = extractFrom("Plan\n- Order\n  - three\n  - four\n- Mend", 5, 29);
  expect(item.child).toBe("Order\n- three\n- four");
  expect(item.replace("abc12345")).toBe("Plan\n- !((abc12345))\n- Mend");
});

test("extract makes the passage a child and leaves a transclusion in its place, attributed to the extension", async () => {
  const { client, create, get, kids } = await setup();
  const note = await create("Garden plan\nMend the north fence before the beans go in, said the wind.");
  const done = await onPassage(client, "extract", note, "Mend the north fence before the beans go in");
  expect(done.message).toContain("extracted");
  const [child] = await kids(note.id);
  expect(child!.text).toBe("Mend the north fence before the beans go in");
  expect(child!.actorId).toBe("ext:structure");
  expect((await get(note.id)).text).toBe(`Garden plan\n!((${child!.id})), said the wind.`);
  // One step: undone, the note reads as it did and the child is in the Trash.
  await client.request({ action: "extensions.undo", undo: (done as { undo?: string }).undo!, mutation: PERSON });
  expect((await get(note.id)).text).toBe("Garden plan\nMend the north fence before the beans go in, said the wind.");
  expect(await kids(note.id)).toEqual([]);
});

test("extract of a list item takes its children and keeps the bullet", async () => {
  const { client, create, get, kids } = await setup();
  const note = await create("Garden plan\n- Order the compost\n  - three bags\n  - ask about delivery\n- Mend the fence");
  await onPassage(client, "extract", note, "- Order the compost\n  - three bags\n  - ask about delivery", LOKI);
  const [child] = await kids(note.id);
  expect(child!.text).toBe("Order the compost\n- three bags\n- ask about delivery");
  expect((await get(note.id)).text).toBe(`Garden plan\n- !((${child!.id}))\n- Mend the fence`);
});

test("sort-list sorts by title, by an argument, and by the block's own sort-by", async () => {
  const { create, get, act } = await setup();
  const seeds = await create("Seeds\n- Tomato [price::3.50]\n- Basil [price::2]\n- Pumpkin [price::12.25]\n- Chive");
  await act("sort-list", seeds.id);
  expect((await get(seeds.id)).text).toBe("Seeds\n- Basil [price::2]\n- Chive\n- Pumpkin [price::12.25]\n- Tomato [price::3.50]");
  await act("sort-list", seeds.id, { args: { by: "price", order: "desc" } });
  expect((await get(seeds.id)).text).toBe("Seeds\n- Pumpkin [price::12.25]\n- Tomato [price::3.50]\n- Basil [price::2]\n- Chive");
  const bad = await act("sort-list", seeds.id, { args: { by: "cost" }, mutation: LOKI });
  expect(bad.message).toContain("no item has cost; the items have price");
  // The note says its own default: the service fills in by= and order= from [sort-by::] and [sort-order::].
  const own = await create("Bulbs [sort-by::price] [sort-order::desc]\n- Tulip [price::4]\n- Crocus [price::9]");
  await act("sort-list", own.id);
  expect((await get(own.id)).text).toBe("Bulbs [sort-by::price] [sort-order::desc]\n- Crocus [price::9]\n- Tulip [price::4]");
});

test("sort-selection sorts only the selected list, and keeps a numbered list numbered", async () => {
  const { client, create, get } = await setup();
  const note = await create("Two\n- b\n- a\n\n1. z\n2. y");
  await onPassage(client, "sort-selection", note, "1. z\n2. y");
  expect((await get(note.id)).text).toBe("Two\n- b\n- a\n\n1. y\n2. z");
});

test("sort-blocks orders children by title, created and a property", async () => {
  const { create, kids, act } = await setup();
  const beds = await create("Beds");
  for (const t of ["Root bed [bed-size::12]", "Herb bed [bed-size::4]", "Bean row [bed-size::6]", "Fern corner"]) await create(t, beds.id);
  await act("sort-blocks", beds.id);
  expect((await kids(beds.id)).map((b) => b.text.split(" [")[0])).toEqual(["Bean row", "Fern corner", "Herb bed", "Root bed"]);
  await act("sort-blocks", beds.id, { args: { by: "bed-size" } });
  expect((await kids(beds.id)).map((b) => b.text.split(" [")[0])).toEqual(["Herb bed", "Bean row", "Root bed", "Fern corner"]);
  await act("sort-blocks", beds.id, { args: { by: "created", order: "desc" } });
  expect((await kids(beds.id)).map((b) => b.text.split(" [")[0])).toEqual(["Fern corner", "Bean row", "Herb bed", "Root bed"]);
});

test("the demo notes are written under the extension's page", async () => {
  const { client } = await setup();
  const list = await client.request<{ extensions: { id: string; pages?: string }[]; pages?: Record<string, string> }>({ action: "extensions.list" });
  expect(list.pages?.structure).toBeTruthy();
});

test("a selection sorts whole items with their sub-items, code fences aren't lists, and a sub-item's property isn't its parent's", () => {
  const text = "N\n- b\n  - child B\n- a\n  - child A";
  const touched = sortListInText(text, sortSpec(undefined), 0, [3, 4]);
  expect(touched.text).toBe("N\n- b\n  - child B\n- a\n  - child A");
  expect(sortListInText(text, sortSpec(undefined), 0, [1, 4]).text).toBe("N\n- a\n  - child A\n- b\n  - child B");
  const fenced = "N\n```\n- z\n- a\n```\n- y\n- x";
  expect(sortListInText(fenced, sortSpec(undefined)).text).toBe("N\n```\n- z\n- a\n```\n- x\n- y");
  const nested = "N\n- one\n  - [price::1]\n- two [price::5]";
  expect(sortListInText(nested, sortSpec({ by: "price", order: "desc" })).text).toBe("N\n- two [price::5]\n- one\n  - [price::1]");
});
