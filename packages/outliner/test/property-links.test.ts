// PIE-663: a property value holding wiki links or labelled references parses whole, end to end through the store.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { parseSearchExpression } from "../src/block-query";
import { createPropertyInspectorModel } from "../src/property-inspector";
import { OutlinerStore } from "../src/store";

const ID = "0f3c8a21-5b7d-4e69-8a10-2c4d6e8f0a1b";
const REAL = `Plan the plot [related::[[PC-967]], ((${ID}|daytime plan step 6))] [type::task]`;

const dirs: string[] = [];
const stores: OutlinerStore[] = [];
function makeStore(): OutlinerStore {
  const directory = mkdtempSync(join(tmpdir(), "ep0ch-prop-links-"));
  dirs.push(directory);
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  stores.push(store);
  return store;
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("the stored property rows hold the whole value", () => {
  const store = makeStore();
  const block = store.create(REAL);
  const related = store.get(block.id)!.properties.find(p => p.key === "related");
  expect(related?.value).toBe(`[[PC-967]], ((${ID}|daytime plan step 6))`);
  expect(store.get(block.id)!.properties.find(p => p.key === "type")?.value).toBe("task");
});

test("related=[[X]] finds the block through filters, the expression and matchQuery; near misses do not", () => {
  const store = makeStore();
  const hit = store.create(REAL);
  const alone = store.create("Just one [related::[[PC-967]]]");
  const other = store.create("Other [related::[[PC-9670]], [[PC-96]]]");
  const label = store.create(`Labelled [related::((${ID}|see [[PC-967]] and more))]`);
  const ids = (filters: { key: string; value?: string }[]) => store.queryBlocks({ filters, limit: 50 }).blocks.map(b => b.id).sort();

  expect(ids([{ key: "related", value: "[[PC-967]]" }])).toEqual([hit.id, alone.id].sort());
  expect(ids([{ key: "related", value: "[[pc-967]]" }])).toEqual([hit.id, alone.id].sort());
  expect(ids([{ key: "related", value: `((${ID}|daytime plan step 6))` }])).toEqual([hit.id]);
  expect(ids([{ key: "related", value: "[[PC-96]]" }])).toEqual([other.id]);

  const commas = store.create(`Commas [related::[[Z]], ((${ID}|a, b)), [[Y]]]`);
  expect(ids([{ key: "related", value: `((${ID}|a, b))` }])).toEqual([commas.id]);
  const embedded = store.create(`Embedded [related::((${ID}|x, [[Q]], y))]`);
  expect(ids([{ key: "related", value: "[[Q]]" }])).toEqual([]);
  expect(embedded.id).toBeTruthy();

  const { filters } = parseSearchExpression("related=[[PC-967]]");
  expect(filters).toEqual([{ key: "related", value: "[[PC-967]]" }]);
  const { filters: quoted } = parseSearchExpression(`related="((${ID}|daytime plan step 6))" type=task`);
  expect(ids(quoted)).toEqual([hit.id]);
  expect(store.matchQuery("related=[[PC-967]] OR related=[[nope]]", [hit.id, alone.id, other.id, label.id]).blockIds).toEqual([hit.id, alone.id]);
});

test("writing a link as a property value is allowed, a stray ] is still refused", () => {
  const store = makeStore();
  const block = store.create("Note");
  const patched = store.patchProperties(block.id, store.get(block.id)!.revision, [{ op: "append", key: "related", value: `[[PC-967]], ((${ID}|a, b))` }]);
  expect(patched.properties.find(p => p.key === "related")?.value).toBe(`[[PC-967]], ((${ID}|a, b))`);
  expect(() => store.patchProperties(block.id, patched.revision, [{ op: "append", key: "related", value: "a]b" }])).toThrow(/balanced/);
});

test("the header line, the inspector and the unbalanced tail", () => {
  expect(headerLine(REAL).chips.map(c => [c.key, c.value])).toEqual([["related", `[[PC-967]], ((${ID}|daytime plan step 6))`], ["type", "task"]]);
  const model = createPropertyInspectorModel("b1", REAL);
  expect(model.entries.map(e => [e.key, e.value])).toEqual([["related", `[[PC-967]], ((${ID}|daytime plan step 6))`], ["type", "task"]]);
  const damaged = createPropertyInspectorModel("b2", "Title [note::oops [ here] [k::v]\nBody line [z::1]");
  expect(damaged.entries.map(e => e.key)).toEqual(["note", "k", "z"]);
});

test("an outline indexed with the truncating parser is re-indexed when the host opens it", () => {
  const directory = mkdtempSync(join(tmpdir(), "ep0ch-prop-links-reindex-"));
  dirs.push(directory);
  const path = join(directory, "outliner.sqlite");
  const first = new OutlinerStore(path);
  const block = first.create(REAL);
  // What parser version 7 stored: the value cut at the first `]`, under the old version number.
  first.database.query("UPDATE block_properties SET value = '[[PC-967' WHERE block_id = ? AND key = 'related'").run(block.id);
  first.database.query("UPDATE metadata SET value = '7' WHERE key = 'property_parser_version'").run();
  first.close();
  const second = new OutlinerStore(path);
  stores.push(second);
  expect(second.get(block.id)!.properties.find(p => p.key === "related")?.value).toBe(`[[PC-967]], ((${ID}|daytime plan step 6))`);
  expect(second.queryBlocks({ filters: [{ key: "related", value: "[[PC-967]]" }], limit: 5 }).blocks.map(b => b.id)).toEqual([block.id]);
});
