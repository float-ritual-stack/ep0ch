import { replaceReferenceIndex } from "../src/reference-index";
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { OutlinerClient } from "../src/client";
import { actionOf, noteWork, requestSubject, subjectLabel, turnKeyOf, Turns, watchEventLoop, type LoopStall } from "../src/loop-watch";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, TreeIndexSnapshot } from "../src/types";
import { reviewBackfill } from "../src/write-review-backfill";
import { readBlockRecords } from "../src/block-records";

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

async function until(ok: () => boolean, ms = 30_000): Promise<void> {
  for (const end = Date.now() + ms; !ok();) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); }
}

const graphOf = (store: OutlinerStore) => (store as unknown as { loadGraph(): { byId: Map<string, Block> } }).loadGraph();

test("a whole-outline mirror and grep leave an 11,000-note host responsive", async () => {
  const { root, store, done } = scratch("mirror-load");
  const socket = join(root, "host.sock"), dir = join(root, "mirror");
  const server = new OutlinerServer(store, socket), reader = new OutlinerClient(socket);
  let mirror: import("bun").Subprocess<"ignore", "ignore", "pipe"> | undefined, pinging: Promise<void> | undefined;
  let running = true;
  const pings: number[] = [], stalls: LoopStall[] = [];
  let watch: ReturnType<typeof watchEventLoop> | undefined;
  try {
    let last!: Block;
    store.database.transaction(() => {
      for (let i = 0; i < 11_000; i++) last = store.create(`Seed packet ${i} [bed::b${i % 40}]\nHarvest moon over row ${i}.`);
    })();
    await server.start();
    watch = watchEventLoop(stall => stalls.push(stall), { sampleMs: 10, reportMs: 40 });
    pinging = (async () => {
      while (running) {
        const at = performance.now();
        await reader.request({ action: "ping" });
        pings.push(performance.now() - at);
        await Bun.sleep(25);
      }
    })();
    mirror = Bun.spawn(["bun", join(import.meta.dir, "../../door/src/main.ts"), "mirror", dir, "--ws", "garden", "--here"], {
      env: { ...process.env, EP0CH_SOCKET: socket, EP0CH_OUTLINES: root, EP0CH_STATE: join(root, "door"), EP0CH_CONTROL: join(root, "control.sock") },
      stdin: "ignore", stdout: "ignore", stderr: "pipe",
    });
    const errors = new Response(mirror.stderr).text();
    const manifestFile = join(dir, "manifest.json");
    await until(() => existsSync(manifestFile) || mirror!.exitCode !== null);
    if (mirror.exitCode !== null) throw new Error(await errors);
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    const file = join(dir, manifest.files.find((f: string) => f.endsWith(`-${last.id.slice(0, 8)}.md`)));
    expect(readFileSync(file, "utf8")).toContain("Harvest moon over row 10999.");
    const started = performance.now();
    await reader.request({ action: "update", blockId: last.id, text: `${last.text}\nFresh after the rain.`, expectedRevision: last.revision, mutation: { author: "user" } });
    await until(() => readFileSync(file, "utf8").includes("Fresh after the rain."), 1000);
    const refreshed = Math.round(performance.now() - started);
    const result = await reader.request<{ matches: { id: string; line: number; text: string }[]; more: boolean }>({ action: "blocks.grep", pattern: "^Harvest moon" });
    expect(result.matches).toHaveLength(11_000);
    expect(result.matches.at(-1)).toMatchObject({ id: last.id, line: 2, text: "Harvest moon over row 10999." });
    expect(result.more).toBe(false);
    running = false; await pinging;
    const sorted = pings.sort((a, b) => a - b);
    const at = (fraction: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!);
    const stall = Math.round(Math.max(0, ...stalls.map(s => s.ms)));
    console.log(`mirror and grep, 11000 notes: edit=${refreshed}ms ping p50=${at(0.5)}ms p95=${at(0.95)}ms p99=${at(0.99)}ms max=${at(1)}ms stall=${stall}ms`);
    expect(at(0.95)).toBeLessThan(200);
    expect(Math.max(at(1), stall)).toBeLessThan(1000);
  } finally {
    running = false; await pinging;
    if (mirror) { mirror.kill("SIGTERM"); await mirror.exited; }
    watch?.stop(); await server.close(); done();
  }
}, 120_000);

test("switching an extension's kept rules leaves a large outline's watching reader responsive", async () => {
  const { root, store, done } = scratch("extension-rule-load");
  const server = new OutlinerServer(store, join(root, "host.sock"));
  const client = new OutlinerClient(join(root, "host.sock")), reader = new OutlinerClient(join(root, "host.sock"));
  let running = true;
  let pinging: Promise<void> | undefined;
  try {
    store.database.transaction(() => {
      for (let i = 0; i < 11_000; i++) store.create(`Seed packet ${i} [type::packet] [bed::b${i % 40}]\n\nSown in row ${i % 12}.`, null, "user");
      for (let i = 0; i < 5; i++) store.create(`Garden rule ${i} [rule-name::garden-${i}] [rule-match::type=request] [rule-on::intake/prior-art]`, null, "user");
    })();
    await server.start();
    await client.request({ action: "extensions.install", extension: "intake", where: "outline" });
    await reader.request({ action: "blocks.query", query: { where: "rule-name", limit: 50 }, watch: "rules" } as never);
    const pings: number[] = [];
    pinging = (async () => {
      while (running) {
        const at = performance.now();
        await reader.request({ action: "ping" });
        pings.push(performance.now() - at);
        await Bun.sleep(25);
      }
    })();
    await client.request({ action: "extensions.uninstall", extension: "intake", demo: "keep" });
    await client.request({ action: "extensions.install", extension: "intake", where: "outline" });
    for (let i = 0; i < 10; i++) await client.request({ action: "extensions.list" });
    running = false;
    await pinging;
    const sorted = pings.sort((a, b) => a - b);
    const at = (fraction: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!);
    console.log(`extension rule lifecycle, 11000 notes: ping p50=${at(0.5)}ms p95=${at(0.95)}ms p99=${at(0.99)}ms max=${at(1)}ms`);
    expect({ p95: at(0.95) < 200, max: at(1) < 1000 }).toEqual({ p95: true, max: true });
  } finally {
    running = false;
    await pinging;
    await server.close();
    done();
  }
}, 120_000);

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

test("a write patches the graph, and the patched graph is the one a fresh read gives (PIE-1413)", () => {
  const { store, done } = scratch("graph-patch");
  const internals = store as unknown as { readGraph(): ReturnType<typeof graphOf> & Record<string, Map<unknown, unknown>> };
  const readGraph = internals.readGraph.bind(store);
  let wholeReads = 0;
  internals.readGraph = () => { wholeReads += 1; return readGraph(); };
  // Everything a reader can see of a graph, in its order.
  const seen = (graph: ReturnType<typeof internals.readGraph>) => JSON.stringify({
    order: [...graph.byId.values()].map(b => [b.id, b.text, b.revision, b.parentId, b.properties, b.effectiveDeletedRootId ?? null]),
    ...Object.fromEntries((["byParent", "propertyRecordsByBlock", "lineTasksByBlock", "settledBlockRecords", "deletedDescendantCountByRoot"] as const)
      .map(key => [key, [...graph[key] as Map<unknown, unknown>].map(([k, v]) => [k, v instanceof Map ? [...v] : Array.isArray(v) ? v.map(x => (x as Block)?.id ?? x) : v])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))])),
  });
  try {
    const bed = store.create("Beds [type::hub]");
    const notes = Array.from({ length: 12 }, (_, i) => store.create(`Row ${i} [row::${i % 3}]\n- [ ] sow [crop::bean]\n- [x] dig [crop::leek]`, i % 2 ? bed.id : null));
    graphOf(store);
    const before = wholeReads;
    const steps: Array<[string, () => void]> = [
      ["an edit", () => store.update(notes[1]!.id, "Row 1, sown [row::9]\n- [x] sow [crop::bean]", store.require(notes[1]!.id).revision)],
      ["a new note", () => store.create("Row 12 [row::1]", bed.id)],
      ["a new note first among its siblings", () => store.create("Row 13 [row::2]", bed.id, "agent", { actorId: "moss" })],
      ["a move", () => store.move(notes[2]!.id, bed.id, 0)],
      ["a trash", () => store.delete(notes[3]!.id)],
      ["a restore", () => store.restore(notes[3]!.id)],
      ["a nested trash", () => { store.create("Under row 5", notes[5]!.id); store.delete(notes[5]!.id); }],
      ["an edit inside a rolled back transaction, then one that lands", () => {
        expect(() => store.database.transaction(() => { store.update(notes[7]!.id, "half", store.require(notes[7]!.id).revision); graphOf(store); throw new Error("abandoned"); })()).toThrow("abandoned");
        store.update(notes[7]!.id, "Row 7 [row::7]", store.require(notes[7]!.id).revision);
      }],
    ];
    for (const [what, step] of steps) {
      step();
      const patched = graphOf(store) as ReturnType<typeof internals.readGraph>;
      expect(`${what}: ${seen(patched)}`).toBe(`${what}: ${seen(readGraph())}`);
    }
    // Only the rolled back transaction read the whole outline again.
    expect(wholeReads - before).toBe(1);
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

test("whoever used the loop least goes next: a ping waits for one of an import's writes, not every one in line (PIE-1413)", async () => {
  let now = 0;
  const turns = new Turns(() => now);
  const order: string[] = [];
  const importer = {}, door = {};
  // An import that has been writing: each of its turns took 20 ms, and four more are waiting.
  for (let i = 0; i < 10; i++) turns.charge(importer, 20);
  const writes = Array.from({ length: 4 }, (_, i) => turns.next("create", importer).then(() => { order.push(`write-${i}`); turns.charge(importer, 20); }));
  const ping = turns.next("ping", door).then(() => { order.push("ping"); });
  await Promise.all([...writes, ping]);
  expect(order.indexOf("ping")).toBeLessThanOrEqual(1);
  expect(order.filter(label => label.startsWith("write"))).toEqual(["write-0", "write-1", "write-2", "write-3"]);
  // Forgotten as time goes: a second later it has used half as much.
  const used = turns.used(importer);
  now += 1_000;
  expect(turns.used(importer)).toBeCloseTo(used / 2, 5);
  expect(turnKeyOf(`{"id":"1","action":"create","author":"agent","actorId":"moss"}`, door)).toBe("actor:moss");
  expect(turnKeyOf(`{"id":"1","action":"create","text":"a note that says \\"actorId\\":\\"x\\""}`, door)).toBe(door);
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

// PIE-1413, found live on pie (Oct 29; the case is jev-in-use's): a write-review backfill --into stalled the host 5–8 s
// per note's records, and a door waited up to 64 s. The host stays fair: a door's ping answers at once while it runs,
// with the door watching the very records it writes. The timing guard at pie's size is scripts/bench-host-fairness.ts.
test("a backfill --into leaves a watching door's ping answered at once (PIE-1413)", async () => {
  const { root, store, done } = scratch("backfill-load");
  const server = new OutlinerServer(store, join(root, "host.sock"));
  const client = new OutlinerClient(join(root, "host.sock")), door = new OutlinerClient(join(root, "host.sock"));
  try {
    // Old notes first, then the agents' walls the backfill reviews (the newest).
    store.database.transaction(() => {
      for (let i = 0; i < 6000; i++) store.create(`Seed packet ${i} [type::packet] [bed::b${i % 40}]\n\nSown in row ${i % 12}.`, null, "user");
    })();
    // Notes made faster than one a millisecond are stamped ahead of the clock: wait until it has caught up.
    const newest = Date.parse((store.database.query("SELECT max(created_at) AS at FROM blocks").get() as { at: string }).at);
    await Bun.sleep(Math.max(0, newest - Date.now()) + 5);
    store.database.transaction(() => {
      const wall = (i: number) => `Shed status ${i}\n\n- The roof went on at nine and the felt was cut to size. The tacks ran out halfway; we borrowed a box. Then the rain held off.\n- Evan, should we paint it now or wait for spring?\n\n${"The gutter came down and went back up again. ".repeat(5)}`;
      for (let i = 0; i < 40; i++) store.create(wall(i), null, "agent", { actorId: "moss/claude-code@shed" });
    })();
    await server.start();
    // A door watching what the backfill writes, as the suggestions page does: its queries are evaluated after changes.
    await door.request({ action: "blocks.query", query: { where: "type=review-finding", sort: "updated desc", limit: 50, machinery: "show" }, watch: "findings" } as never);
    await door.request({ action: "blocks.query", query: { where: "type=packet", group: "bed", limit: 20 }, watch: "packets" } as never);
    let running = true;
    const pings: number[] = [];
    const pinging = (async () => {
      while (running) {
        const at = performance.now();
        await door.request({ action: "ping" } as never);
        pings.push(performance.now() - at);
        await Bun.sleep(25);
      }
    })();
    const report = await reviewBackfill(client as never, { since: "7d", jev: false, into: client as never, limit: 40 });
    running = false;
    await pinging;
    expect(report.reviewed).toBe(40);
    expect(report.findings).toBeGreaterThan(40);
    const sorted = pings.sort((a, b) => a - b);
    expect({ p95: sorted[Math.floor(sorted.length * 0.95)]! < 200, max: sorted.at(-1)! < 1_000 }).toEqual({ p95: true, max: true });
  } finally {
    await server.close();
    done();
  }
}, 300_000);

// PIE-1413's second round, found by driving a door on the Desk: a board's lane reads, queued on the door's one
// connection, held its note reads and saves behind them for minutes, and a closed door's queue kept running.
test("a connection's whole-outline reads never hold its note read or its save, and a closed connection's queue is dropped", async () => {
  const { root, store, done } = scratch("own-connection");
  const server = new OutlinerServer(store, join(root, "host.sock"));
  try {
    store.database.transaction(() => { for (let i = 0; i < 3000; i++) store.create(`Seed packet ${i} [type::packet] [bed::b${i % 40}]`, null, "user"); })();
    const note = store.create("Shed key [type::note]", null, "user");
    for (let i = 0; i < 40; i++) store.create(`Lane ${i} [type::virtual-branch] [query::type=packet bed=b${i}]`, null, "user");
    const views = store.queryBlocks({ filters: [{ key: "type", value: "virtual-branch" }], limit: 100 }).blocks.map(b => b.id);
    await server.start();
    const reads = graphReads(store);
    const open = () => {
      const socket = connect(join(root, "host.sock"));
      socket.setEncoding("utf8");
      const answered = new Map<string, number>();
      let buffer = "";
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) { answered.set(JSON.parse(buffer.slice(0, at)).id, performance.now()); buffer = buffer.slice(at + 1); }
      });
      const send = (id: string, request: object) => socket.write(`${JSON.stringify({ id, ...request })}\n`);
      return { socket, answered, send };
    };
    // A door: every lane's read sent at once, then its person reads a note and saves it, all on the one connection.
    const door = open();
    const sent = performance.now();
    for (const [i, viewId] of views.entries()) door.send(`lane-${i}`, { action: "views.read", viewId, format: "tree" });
    door.send("note", { action: "children", blockId: note.id });
    door.send("save", { action: "update", blockId: note.id, text: "Shed key, by the door [type::note]", expectedRevision: note.revision, mutation: { author: "user" } });
    await until(() => door.answered.size === views.length + 2);
    const lanesDone = Math.max(...views.map((_, i) => door.answered.get(`lane-${i}`)!));
    expect(door.answered.get("note")!).toBeLessThan(lanesDone);
    expect(door.answered.get("save")!).toBeLessThan(lanesDone);
    expect(door.answered.get("save")! - sent).toBeLessThan((lanesDone - sent) / 2);
    door.socket.destroy();
    // A door that goes away with its lanes asked: nobody waits for them, and the host doesn't read them.
    const gone = open();
    await new Promise(resolve => gone.socket.once("connect", resolve));
    const before = reads();
    for (const [i, viewId] of views.entries()) gone.send(`lane-${i}`, { action: "views.read", viewId, format: "tree" });
    gone.socket.destroy();
    await Bun.sleep(300);
    const after = store.get(note.id);
    expect(after?.text).toBe("Shed key, by the door [type::note]");
    expect(reads() - before).toBeLessThan(views.length / 4);
  } finally {
    await server.close();
    done();
  }
}, 120_000);

// Seen live on gurgle (Oct 29): one `blocks.records` of 200 notes held the loop 24 s, checking every value-reading
// note's deps twice for each record. The value references are checked once per change to the outline.
test("a records read of many notes checks the value-reading notes once, not once a note (PIE-1413)", () => {
  const { store, done } = scratch("records-values");
  try {
    // Notes whose links are built from values: each reads its 30 children.
    for (let i = 0; i < 5; i++) {
      const shelf = store.create(`Shelf ${i}\n[[{{this.children}}]]`);
      for (let j = 0; j < 30; j++) store.create(`Tool ${i}.${j}`, shelf.id);
    }
    const notes = Array.from({ length: 100 }, (_, i) => store.create(`Note ${i}`).id);
    const internals = store as unknown as { valueReferenceVersion(id: string): string };
    const version = internals.valueReferenceVersion.bind(store);
    let checks = 0;
    internals.valueReferenceVersion = (id: string) => { checks += 1; return version(id); };
    store.referenceValues(notes[0]!);
    const once = checks;
    readBlockRecords(store as never, notes);
    expect(checks).toBe(once);
    store.update(notes[1]!, "Note 1, oiled", store.require(notes[1]!).revision);
    readBlockRecords(store as never, notes);
    expect(checks - once).toBeLessThanOrEqual(once);
  } finally {
    done();
  }
});
