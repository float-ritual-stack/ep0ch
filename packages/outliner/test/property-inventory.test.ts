import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, PropertyInventory } from "../src/types";

const fixtures: Array<{ store: OutlinerStore; directory: string; server?: OutlinerServer }> = [];
const key = "inventory-kind";

function makeStore() {
  const directory = mkdtempSync(join(tmpdir(), "outliner-property-inventory-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const fixture: (typeof fixtures)[number] = { store, directory };
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  for (const { store, directory, server } of fixtures.splice(0)) {
    await server?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("inventory returns every distinct value beyond the autocomplete catalog's cap", () => {
  const { store } = makeStore();
  const totalBefore = store.readWorkspaceSnapshot().physical.blocks.length;
  const values = Array.from({ length: 137 }, (_, index) => `kind-${String(index).padStart(3, "0")}`);
  store.create(`Many kinds ${[...values].reverse().map(value => `[${key}::${value}]`).join(" ")}`);

  expect(store.propertyCatalog(key, "", 1000)).toHaveLength(100);
  expect(store.propertyInventory({ key: " Inventory-Kind " })).toEqual({
    key,
    propertyScope: "block",
    items: values.map(value => ({ key, value, count: 1 })),
    totalValues: 137,
    totalBlocks: totalBefore + 1,
    matchedBlocks: 1,
    offset: 0,
    nextOffset: null,
    complete: true,
    sequence: store.sequence,
  });
});

test("large inventories page deterministically and expose the sequence for detecting changes", () => {
  const { store } = makeStore();
  const values = Array.from({ length: 1207 }, (_, index) => `kind-${String(index).padStart(4, "0")}`);
  const block = store.create(`Many kinds ${[...values].reverse().map(value => `[${key}::${value}]`).join(" ")}`);
  const first = store.propertyInventory({ key });
  expect(first).toMatchObject({ totalValues: 1207, matchedBlocks: 1, offset: 0, nextOffset: 1000, complete: false });
  expect(first.items).toHaveLength(1000);

  const last = store.propertyInventory({ key, offset: first.nextOffset! });
  expect(last).toMatchObject({ totalValues: 1207, matchedBlocks: 1, offset: 1000, nextOffset: null, complete: false });
  expect(last.items).toHaveLength(207);
  expect(last.sequence).toBe(first.sequence);
  expect([...first.items, ...last.items].map(item => item.value)).toEqual(values);

  const beyond = store.propertyInventory({ key, offset: 1300 });
  expect(beyond).toMatchObject({ items: [], totalValues: 1207, offset: 1300, nextOffset: null, complete: false });

  store.patchProperties(block.id, block.revision, [{ op: "append", key, value: "added-later" }]);
  const afterChange = store.propertyInventory({ key, offset: 1000, limit: 100 });
  expect(afterChange.sequence).toBeGreaterThan(first.sequence);
  expect(afterChange).toMatchObject({ totalValues: 1208, offset: 1000, nextOffset: 1100, complete: false });
  expect(afterChange.items).toHaveLength(100);
});

test("value counts identify distinct live blocks, omit trashed subtrees, and retain untyped totals", () => {
  const { store } = makeStore();
  const totalBefore = store.readWorkspaceSnapshot().physical.blocks.length;
  store.create(`Repeated [${key}::shared] [${key}::shared] [${key}::solo]`);
  store.create(`Another [${key}::shared]`);
  store.create("Untyped material");
  const parent = store.create(`Retired group [${key}::deleted-parent]`);
  const child = store.create(`Retired child [${key}::deleted-child] [${key}::shared]`, parent.id);
  store.delete(parent.id);
  expect(store.require(child.id).effectiveDeletedRootId).toBe(parent.id);

  expect(store.propertyInventory({ key })).toMatchObject({
    items: [{ key, value: "shared", count: 2 }, { key, value: "solo", count: 1 }],
    totalValues: 2,
    matchedBlocks: 2,
    totalBlocks: totalBefore + 3,
    complete: true,
  });
});

test("inventory scope defaults to block properties and all scope deduplicates across scopes", () => {
  const { store } = makeStore();
  store.create([
    `Scopes [${key}::block] [${key}::shared]`,
    "",
    `Body [${key}::inline] [${key}::shared]`,
    `${key}:: line`,
  ].join("\n"));
  const itemsFor = (propertyScope?: "block" | "inline" | "line" | "all") =>
    store.propertyInventory({ key, propertyScope }).items;
  expect(itemsFor()).toEqual([{ key, value: "block", count: 1 }, { key, value: "shared", count: 1 }]);
  expect(itemsFor("block")).toEqual(itemsFor());
  expect(itemsFor("inline")).toEqual([{ key, value: "inline", count: 1 }, { key, value: "shared", count: 1 }]);
  expect(itemsFor("line")).toEqual([{ key, value: "line", count: 1 }]);
  expect(store.propertyInventory({ key, propertyScope: "all" })).toMatchObject({
    propertyScope: "all",
    items: ["block", "inline", "line", "shared"].map(value => ({ key, value, count: 1 })),
    totalValues: 4,
    matchedBlocks: 1,
    complete: true,
  });
});

test("an absent property produces a complete empty inventory without implying an empty workspace", () => {
  const { store } = makeStore();
  store.create("Ordinary note");
  const result = store.propertyInventory({ key });
  expect(result).toMatchObject({ items: [], totalValues: 0, matchedBlocks: 0, offset: 0, nextOffset: null, complete: true });
  expect(result.totalBlocks).toBe(store.readWorkspaceSnapshot().physical.blocks.length);
  expect(result.totalBlocks).toBeGreaterThan(0);
});

test("inventory rejects invalid keys, scopes, offsets, and limits", () => {
  const { store } = makeStore();
  type Input = Parameters<OutlinerStore["propertyInventory"]>[0];
  for (const badKey of [undefined, "", " ", "123", "has spaces", "tag=secret", {}, 7]) {
    expect(() => store.propertyInventory({ key: badKey } as Input)).toThrow("property key");
  }
  expect(() => store.propertyInventory({ key, propertyScope: "any" } as unknown as Input)).toThrow("scope");
  for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    expect(() => store.propertyInventory({ key, offset } as Input)).toThrow("offset");
  }
  for (const limit of [0, -1, 0.5, 1001, NaN, Infinity, "100"]) {
    expect(() => store.propertyInventory({ key, limit } as Input)).toThrow("limit");
  }
});

test("properties.inventory round-trips through the service with pagination and validation", async () => {
  const fixture = makeStore();
  const socket = join(fixture.directory, "outliner.sock");
  fixture.server = new OutlinerServer(fixture.store, socket);
  await fixture.server.start();
  const client = new OutlinerClient(socket);
  await client.requireCompatibleService();
  const block = await client.request<Block>({ action: "create", text: `Kinds [${key}::beta] [${key}::alpha] [${key}::alpha]` });
  const first = await client.request<PropertyInventory>({ action: "properties.inventory", key, limit: 1 });
  expect(first).toMatchObject({
    items: [{ key, value: "alpha", count: 1 }], totalValues: 2, matchedBlocks: 1,
    offset: 0, nextOffset: 1, complete: false,
  });
  const last = await client.request<PropertyInventory>({ action: "properties.inventory", key, offset: 1, limit: 1 });
  expect(last).toMatchObject({ items: [{ key, value: "beta", count: 1 }], offset: 1, nextOffset: null, complete: false });
  expect(last.sequence).toBe(first.sequence);
  await expect(client.request({ action: "properties.inventory", key, limit: 1001 })).rejects.toThrow("limit");
  expect((await client.request<Block>({ action: "get", blockId: block.id })).revision).toBe(block.revision);
});
