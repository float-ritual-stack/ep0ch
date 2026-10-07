import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionOf, noteWork, Turns, watchEventLoop, type LoopStall } from "../src/loop-watch";
import { OutlinerStore } from "../src/store";
import type { Block, TreeIndexSnapshot } from "../src/types";

// What keeps the outline host answering (PIE-625). The timing guard is scripts/bench-host-stalls.ts (a note read
// answered in under 200 ms at start-up, under load, during a backup and after a restart); these check the parts it
// rests on, without timing anything.

function scratch(name: string) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  return { root, store, done: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

const graphOf = (store: OutlinerStore) => (store as unknown as { loadGraph(): { byId: Map<string, Block> } }).loadGraph();

test("the outline graph is read once per change, is frozen, and a failed transaction drops it", () => {
  const { store, done } = scratch("graph-cache");
  try {
    const note = store.create("Seed packets [kind::seed]");
    const first = store.database.transaction(() => graphOf(store))();
    expect(store.database.transaction(() => graphOf(store))()).toBe(first);
    // Shared by every reader, so nobody changes it.
    expect(() => { (first.byId.get(note.id) as { text: string }).text = "changed"; }).toThrow();
    expect(() => { (first.byId.get(note.id)!.properties as unknown[]).push({ key: "x", value: "y" }); }).toThrow();

    store.update(note.id, "Seed packets, sorted [kind::seed]", note.revision);
    const second = store.database.transaction(() => graphOf(store))();
    expect(second).not.toBe(first);
    expect(second.byId.get(note.id)!.text).toBe("Seed packets, sorted [kind::seed]");

    // A write that is rolled back leaves the change counts where they were: the graph read inside it must go.
    expect(() => store.database.transaction(() => {
      store.database.query("UPDATE blocks SET text = 'half done' WHERE id = ?").run(note.id);
      expect(graphOf(store).byId.get(note.id)!.text).toBe("half done");
      throw new Error("abandoned");
    })()).toThrow("abandoned");
    expect(store.database.transaction(() => graphOf(store))().byId.get(note.id)!.text).toBe("Seed packets, sorted [kind::seed]");
    expect(store.queryBlocks({ filters: [{ key: "kind", value: "seed" }], limit: 10 }).blocks.map(block => block.text)).toEqual(["Seed packets, sorted [kind::seed]"]);
  } finally {
    done();
  }
});

test("the tree index made a slice at a time is the one read at once", async () => {
  const { store, done } = scratch("tree-slices");
  try {
    const hub = store.create("Garden hub [type::hub]");
    const beds = Array.from({ length: 450 }, (_, i) => store.create(`Bed ${i} [row::${i % 7}]\nNext to ((${hub.id}))`, i % 3 ? hub.id : null));
    store.create(`Beds view [type::virtual-branch] [query::row=3]`, hub.id);
    store.create(`Notes on ((${beds[5]!.id})) and ((${beds[9]!.id}^missing))`);
    let pauses = 0;
    const sliced = await store.readTreeIndexInSlices({}, async () => { pauses += 1; });
    expect(pauses).toBeGreaterThan(2);
    expect(sliced).toEqual(store.readTreeIndex() as TreeIndexSnapshot);
    const query = { query: { filters: [{ key: "row", value: "3" }], limit: 20 } };
    expect(await store.readTreeIndexInSlices(query, async () => {})).toEqual(store.readTreeIndex(query));
  } finally {
    done();
  }
});

test("a note read gets its turn before a burst of whole-outline reads queued ahead of it", async () => {
  const turns = new Turns();
  const order: string[] = [];
  const take = (label: string, action: string) => turns.next(action).then(() => { order.push(label); });
  const burst = Array.from({ length: 4 }, (_, i) => take(`view-${i}`, "views.read"));
  const first = take("note", "get");
  await first;
  // One turn per pass of the loop: a request that arrives mid-burst goes next.
  const late = new Promise<void>(resolve => setImmediate(() => { void take("write", "update").then(resolve); }));
  await Promise.all([...burst, late]);
  expect(order[0]).toBe("note");
  expect(order.indexOf("write")).toBeLessThan(order.indexOf("view-3"));
  expect(order.filter(label => label.startsWith("view"))).toEqual(["view-0", "view-1", "view-2", "view-3"]);
  expect(actionOf(`{"id":"1","action":"views.read","viewId":"x"}`)).toBe("views.read");
});

test("a loop stall is reported with the work that held it", async () => {
  const stalls: LoopStall[] = [];
  const watch = watchEventLoop(stall => stalls.push(stall), { sampleMs: 10, reportMs: 40 });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    const started = performance.now();
    while (performance.now() - started < 120) { /* holds the loop */ }
    noteWork("tree.index", 70);
    noteWork("views.read", 30);
    noteWork("views.read", 30);
    await new Promise(resolve => setTimeout(resolve, 40));
  } finally {
    watch.stop();
  }
  expect(stalls.length).toBeGreaterThan(0);
  expect(stalls[0]!.ms).toBeGreaterThanOrEqual(80);
  expect(stalls[0]!.during).toEqual(["tree.index 70", "views.read 60 (2×)"]);
});
