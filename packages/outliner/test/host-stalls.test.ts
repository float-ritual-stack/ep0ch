import { replaceReferenceIndex } from "../src/reference-index";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { OutlinerClient } from "../src/client";
import { actionOf, noteWork, requestSubject, subjectLabel, Turns, watchEventLoop, type LoopStall } from "../src/loop-watch";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, TreeIndexSnapshot } from "../src/types";

// What keeps the outline host answering (PIE-625). The timing guard is scripts/bench-host-stalls.ts (a note read
// answered in under 200 ms at start-up, under load, during a backup and after a restart). The bounded-read
// regressions count whole-outline graph accesses while exercising real scratch stores.

function scratch(name: string) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  return { root, store, done: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

// Count graph accesses, not elapsed time: a scheduler pause is not a whole-outline scan.
function graphReads(store: OutlinerStore) {
  const internals = store as unknown as { loadGraph(): unknown };
  const loadGraph = internals.loadGraph.bind(store);
  let reads = 0;
  internals.loadGraph = () => { reads += 1; return loadGraph(); };
  return () => reads;
}

const graphOf = (store: OutlinerStore) => (store as unknown as { loadGraph(): { byId: Map<string, Block> } }).loadGraph();

test("a write's fan-out in a 50,000-block outline leaves another outline responsive (PIE-1001)", async () => {
  const { root, store, done } = scratch("fanout-latency");
  const small = new OutlinerStore(join(root, "small.sqlite"));
  const server = new OutlinerServer(store, join(root, "large.sock"));
  const other = new OutlinerServer(small, join(root, "small.sock"));
  let socket: ReturnType<typeof connect> | undefined;
  try {
    const target = store.create("Needle [kind::seed]");
    const note = small.create("Small note");
    await server.start();
    await other.start();
    socket = connect(join(root, "large.sock"));
    socket.setEncoding("utf8");
    let buffer = "";
    const replies = new Map<string, (value: { ok: boolean }) => void>();
    let delivered = Promise.withResolvers<void>();
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const message = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (message.event?.action === "draft.patch") delivered.resolve();
        else replies.get(message.id)?.(message);
      }
    });
    const ask = (id: string, request: object) => new Promise<{ ok: boolean }>(resolve => {
      replies.set(id, resolve);
      socket!.write(`${JSON.stringify({ id, ...request })}\n`);
    });
    expect((await ask("subscribe", { action: "events.subscribe", client: { clientId: "garden-door", role: "observer", contextId: "garden" } })).ok).toBe(true);
    for (const kind of ["seed", "tool"]) expect((await ask(kind, {
      action: "blocks.query", query: { where: `kind=${kind}`, limit: 20 }, watch: kind,
    })).ok).toBe(true);
    const client = new OutlinerClient(join(root, "large.sock"));
    const second = new OutlinerClient(join(root, "small.sock"));
    store.database.transaction(() => {
      const insert = store.database.query("INSERT INTO blocks (id, parent_id, position, text, author, created_at, updated_at) VALUES (?, NULL, ?, ?, 'user', ?, ?)");
      for (let i = 0; i < 50_000; i++) insert.run(crypto.randomUUID(), i + 100, `Note ${i}`, target.createdAt, target.createdAt);
    })();
    expect((await ask("warm", { action: "blocks.query", query: { where: "kind=seed", limit: 20 } })).ok).toBe(true);
    const reads = graphReads(store);
    const current = store.require(target.id);
    const write = client.request<{ outcome: string }>({ action: "draft.patch", blockId: target.id, revision: current.revision,
      patches: [{ observed: current.text, replacement: "Needle, mended [kind::seed]" }], mutation: { author: "agent", actorId: "mender" } });
    const read = second.request<Block>({ action: "get", blockId: note.id });
    const [result, reading] = await Promise.all([write, read, delivered.promise]);
    expect(result.outcome).toBe("applied");
    expect(reading.text).toBe("Small note");
    expect(store.get(target.id)?.text).toBe("Needle, mended [kind::seed]");
    expect(reads()).toBe(0);
  } finally {
    socket?.destroy();
    await server.close();
    await other.close();
    small.close();
    done();
  }
}, 120_000);

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

    // A COMMIT that fails (a deferred foreign key) rolls back after the work returned: the graph goes then too.
    expect(() => store.database.transaction(() => {
      store.database.exec("PRAGMA defer_foreign_keys = ON");
      store.database.query("UPDATE blocks SET text = 'orphaned', parent_id = 'no-such-note' WHERE id = ?").run(note.id);
      expect(graphOf(store).byId.get(note.id)!.text).toBe("orphaned");
    }).immediate()).toThrow();
    expect(store.database.transaction(() => graphOf(store))().byId.get(note.id)!.text).toBe("Seed packets, sorted [kind::seed]");
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
    expect(pauses).toBeGreaterThan(0);
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

test("a whole-outline read is never starved by a stream of other requests", async () => {
  const turns = new Turns();
  const order: string[] = [];
  const index = turns.next("tree.index").then(() => { order.push("index"); });
  // Three clients each asking again as soon as they're answered: other requests are always waiting.
  const streams = Array.from({ length: 3 }, async (_, client) => {
    for (let i = 0; i < 20; i++) {
      await turns.next("get");
      order.push(`get-${client}-${i}`);
    }
  });
  await Promise.all([index, ...streams]);
  expect(order.indexOf("index")).toBeLessThan(10);
});

test("a loop stall is reported with the work that held it", async () => {
  const reported = Promise.withResolvers<LoopStall>();
  const watch = watchEventLoop(reported.resolve, { sampleMs: 10, reportMs: 40 });
  try {
    const started = performance.now();
    while (performance.now() - started < 120) { /* holds the loop */ }
    noteWork("tree.index", 70);
    noteWork("views.read", 30);
    noteWork("views.read", 30);
    const stall = await reported.promise;
    expect(stall.ms).toBeGreaterThanOrEqual(80);
    expect(stall.during).toEqual(["tree.index 70", "views.read 60 (2×)"]);
  } finally {
    watch.stop();
  }
});

test("a slow site.answer is logged with the note, figure and query it computed, never a draft's text (PIE-1047)", () => {
  const asked = requestSubject({
    action: "site.answer", blockId: "eb90ffd7-0000-4000-8000-000000000001", hidden: ["a", "b"], draft: { text: "Private seed list" },
    produce: { kind: "unknowable", ids: Array.from({ length: 50 }, (_, i) => `row-${i}`), where: "type=reply AND thread:me" },
  });
  expect(asked).toEqual({ blockId: "eb90ffd7-0000-4000-8000-000000000001", produce: "unknowable", where: "type=reply AND thread:me", ids: 50, hidden: 2, draft: true });
  expect(JSON.stringify(asked)).not.toContain("Private seed list");
  expect(subjectLabel("site.answer", asked)).toBe("site.answer ((eb90ffd7)) unknowable");
  const figure = requestSubject({ action: "site.answer", blockId: "c0ffee00-0000-4000-8000-000000000002", produce: { kind: "figure", figure: "table", props: { query: "type=ticket" } } });
  expect(subjectLabel("site.answer", figure)).toBe("site.answer ((c0ffee00)) graph-table");
  expect(figure.query).toBe("type=ticket");
});

test.each(["backlinks", "records-1", "records-20", "draft.patch", "draft.patch-anchor"] as const)("%s in a 50,000-block outline leaves another outline responsive (PIE-1001)", async (action) => {
  const { root, store: seed, done } = scratch("backlink-latency");
  let store = seed;
  const smallStore = new OutlinerStore(join(root, "small.sqlite"));
  let largeServer: OutlinerServer | undefined;
  const smallServer = new OutlinerServer(smallStore, join(root, "small.sock"));
  try {
    const target = store.create(action === "draft.patch-anchor" ? "Needle\nPassage ^tip" : "Needle");
    const ids = [target.id, ...Array.from({ length: 19 }, (_, i) => store.create(`Requested note ${i}`).id)];
    const unrelated = store.create("Other destination");
    const source = store.create(`Needle source ((${target.id}))`);
    const small = smallStore.create("Small note");
    let server = largeServer = new OutlinerServer(store, join(root, "large.sock"));
    const measure = async () => {
      const request = Promise.resolve().then(() => server.handleAsync(action === "backlinks" ? {
        id: action, action: "references.backlinks", query: { targetBlockId: target.id, limit: 10 },
      } : action === "draft.patch" || action === "draft.patch-anchor" ? {
        id: action, action: "draft.patch", blockId: target.id, revision: store.require(target.id).revision,
        patches: [action === "draft.patch-anchor" ? { observed: " ^tip", replacement: "" } : { observed: "Needle", replacement: "Needle, mended" }],
        mutation: { author: "agent", actorId: "mender" },
      } : { id: action, action: "blocks.records", ids: ids.slice(0, action === "records-1" ? 1 : 20) }));
      const read = new Promise<Awaited<ReturnType<typeof smallServer.handleAsync>>>(resolve => setImmediate(() => {
        resolve(smallServer.handleAsync({ id: "read", action: "get", blockId: small.id }));
      }));
      const [answer, note] = await Promise.all([request, read]);
      return { answer, note };
    };
    store.database.transaction(() => {
      const insert = store.database.query("INSERT INTO blocks (id, parent_id, position, text, author, created_at, updated_at) VALUES (?, NULL, ?, ?, 'user', ?, ?)");
      for (let i = 0; i < 50_000; i++) {
        const id = crypto.randomUUID();
        const text = `Note ${i}\nSee ((${unrelated.id})) and [[Unclaimed page ${i % 100}]].`;
        insert.run(id, i + 100, text, target.createdAt, target.createdAt);
        replaceReferenceIndex(store.database, id, text);
      }
    })();
    await server.close();
    store.close();
    store = new OutlinerStore(join(root, "outline.sqlite"));
    server = largeServer = new OutlinerServer(store, join(root, "large.sock"));
    const reads = graphReads(store);
    const { answer, note } = await measure();
    if (action === "backlinks") expect(answer).toMatchObject({ ok: true, result: { sources: [{ blockId: source.id }] } });
    else if (action === "draft.patch" || action === "draft.patch-anchor") {
      expect(answer).toMatchObject({ ok: true, result: { outcome: "applied" } });
      expect(store.require(target.id).text).toBe(action === "draft.patch-anchor" ? "Needle\nPassage" : "Needle, mended");
    } else expect(answer).toMatchObject({ ok: true, result: { records: ids.slice(0, action === "records-1" ? 1 : 20).map(id => ({ id, backlinks: id === target.id ? [source.id] : [] })) } });
    expect(note).toMatchObject({ ok: true, result: { text: "Small note" } });
    expect(reads()).toBe(0);
  } finally {
    await largeServer?.close();
    store.close();
    await smallServer.close();
    smallStore.close();
    done();
  }
}, 120_000);

test("tree index reuses unchanged labels in an outline with long notes (PIE-1001)", async () => {
  const { store, done } = scratch("tree-label-latency");
  try {
    const target = store.create("Destination");
    store.database.transaction(() => {
      const insert = store.database.query("INSERT INTO blocks (id, parent_id, position, text, author, created_at, updated_at) VALUES (?, NULL, ?, ?, 'user', ?, ?)");
      for (let i = 0; i < 1_000; i++) {
        insert.run(crypto.randomUUID(), i + 100, `Note ${i} ((${target.id}))\n${"Long body of the note. ".repeat(3_000)}`, target.createdAt, target.createdAt);
      }
    })();
    const server = new OutlinerServer(store, join(store.workspaceRoot, "tree.sock"));
    try {
      const read = () => server.handleAsync({ id: "tree", action: "tree.index" });
      const coldStarted = performance.now();
      expect((await read()).ok).toBe(true);
      const coldMs = performance.now() - coldStarted;
      const started = performance.now();
      const answer = await read();
      const ms = performance.now() - started;
      console.log(`PIE-1001: cold tree index ${coldMs.toFixed(1)} ms; repeated ${ms.toFixed(1)} ms`);
      expect(answer.ok).toBe(true);
      expect(ms / coldMs).toBeLessThan(0.25);
    } finally { await server.close(); }
  } finally { done(); }
}, 120_000);

test("a page's question about 50 rows of a 5,000-note outline leaves another outline responsive (PIE-1047)", async () => {
  // Oct 18: a published page asked which rows of a `thread:me` list it may show (`site.answer`'s `unknowable`); the
  // service read every note's links once per row, and held the host for 57 s. It reads the link index once for all rows.
  const { root, store, done } = scratch("unknowable-latency");
  const smallStore = new OutlinerStore(join(root, "small.sqlite"));
  const server = new OutlinerServer(store, join(root, "large.sock"));
  const smallServer = new OutlinerServer(smallStore, join(root, "small.sock"));
  try {
    const page = store.create("Seed swap replies");
    const hub = store.create("Seed library");
    const rows = Array.from({ length: 50 }, (_, i) => store.create(`Reply ${i} about ((${hub.id})) [kind::row]`));
    const locked = store.create(`Locked note about ((${rows[7]!.id}))`);
    const small = smallStore.create("Small note");
    const measure = async () => {
      const started = performance.now();
      const asked = Promise.resolve().then(() => server.handleAsync({
        id: "rows", action: "site.answer", blockId: page.id, hidden: [locked.id],
        produce: { kind: "unknowable", ids: rows.map(row => row.id), where: "kind=row AND thread:me" },
      } as never)).then(result => ({ result, ms: performance.now() - started }));
      const read = new Promise<Awaited<ReturnType<typeof smallServer.handleAsync>>>(resolve => setImmediate(() => {
        resolve(smallServer.handleAsync({ id: "read", action: "get", blockId: small.id }));
      })).then(result => ({ result, ms: performance.now() - started }));
      const [answer, note] = await Promise.all([asked, read]);
      return { answer, note };
    };
    const idle: number[] = [];
    for (let i = 0; i < 7; i++) {
      const { answer, note } = await measure();
      expect(answer.result.ok).toBe(true);
      expect(note.result.ok).toBe(true);
      idle.push(Math.max(answer.ms, note.ms));
    }
    const baseline = idle.sort((a, b) => a - b)[3]!;
    store.database.transaction(() => {
      const insert = store.database.query("INSERT INTO blocks (id, parent_id, position, text, author, created_at, updated_at) VALUES (?, NULL, ?, ?, 'user', ?, ?)");
      for (let i = 0; i < 5_000; i++) {
        const id = crypto.randomUUID();
        const text = `Note ${i}\nSee ((${hub.id})) and [[Unclaimed page ${i % 100}]].`;
        insert.run(id, i + 100, text, page.createdAt, page.createdAt);
        replaceReferenceIndex(store.database, id, text);
      }
    })();
    const samples = [];
    for (let i = 0; i < 7; i++) samples.push(await measure());
    const { answer, note } = samples[0]!;
    const requestMs = samples.map(sample => sample.answer.ms).sort((a, b) => a - b)[3]!;
    const readMs = samples.map(sample => sample.note.ms).sort((a, b) => a - b)[3]!;
    console.log(`PIE-1047: idle ${baseline.toFixed(1)} ms; unknowable over 50 rows ${requestMs.toFixed(1)} ms; second outline ${readMs.toFixed(1)} ms`);
    // Only the row the locked note links to can't be answered for.
    expect(answer.result).toMatchObject({ ok: true, result: { produced: { kind: "unknowable", ids: [rows[7]!.id] } } });
    expect(note.result).toMatchObject({ ok: true, result: { text: "Small note" } });
    expect(requestMs / baseline).toBeLessThan(50);
    expect(readMs / baseline).toBeLessThan(50);
  } finally {
    await server.close();
    await smallServer.close();
    smallStore.close();
    done();
  }
}, 180_000);
