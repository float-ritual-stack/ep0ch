// No request waits over a second (PIE-1546, Nov 6): one test per cause float-2's log named, and the door's scenario
// end to end (scripts/bench-host-queue.ts, the same scenario at pie's shape for numbers).
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blockCommentTarget } from "../src/block-comments";
import { OutlinerClient } from "../src/client";
import { QueueLane, watchEventLoop, type LoopStall } from "../src/loop-watch";
import { OutlineLinks } from "../src/outline-links";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { Conn } from "../scripts/host-bench/wire";

function scratch(name: string) {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  const store = new OutlinerStore(join(root, "outline.sqlite"));
  return { root, store, done: () => { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

/** Every statement the store prepares that holds `marker`, to ask SQLite how it reads it. */
function statementsHolding(store: OutlinerStore, marker: string) {
  const database = store.database as unknown as { query(sql: string): unknown };
  const query = database.query.bind(database);
  const seen: string[] = [];
  database.query = (sql: string) => { if (sql.includes(marker)) seen.push(sql); return query(sql); };
  return seen;
}
const planOf = (store: OutlinerStore, sql: string, args: unknown[]) =>
  (store.database.query(`EXPLAIN QUERY PLAN ${sql}`).all(...args as never[]) as { detail: string }[]).map(row => row.detail);

test("a mark's quotes are read through the property index, and every quote of it is found", () => {
  const { store, done } = scratch("quoted-in");
  try {
    const note = store.create("Shed roof\nThe felt ran out halfway.");
    const mark = store.createAnnotation("mark-1", { target: blockCommentTarget(note), body: "Check the felt.", source: "user" }).annotations[0]!.block.id;
    const other = store.createAnnotation("mark-2", { target: blockCommentTarget(note), body: "And the tacks.", source: "user" }).annotations[0]!.block.id;
    const plain = store.create(`Quoting it [from::((${mark}))]`);
    const labelled = store.create(`Quoting it again [from::((${mark}|the felt))]`);
    store.create(`Quoting the other [from::((${other}))]`);
    const trashed = store.create(`Quoting it, then gone [from::((${mark}))]`);
    store.delete(trashed.id);
    const asked = statementsHolding(store, "property.key = 'from'");
    const threads = store.listAnnotationThreads({ subject: { kind: "block", blockId: note.id }, includeResolved: true });
    expect([...threads.find(thread => thread.block.id === mark)!.quotedIn!].sort()).toEqual([plain.id, labelled.id].sort());
    expect(threads.find(thread => thread.block.id === other)!.quotedIn).toHaveLength(1);
    // A toss lists every note's threads: this ran once per thread over every `from` in the outline (98% of a list on pie).
    const plan = planOf(store, asked[0]!, [`((${mark}))`, `((${mark}|`, `((${mark}}`]).join(" | ");
    expect(plan).toContain("properties_scope_key_value");
    expect(plan).not.toMatch(/SCAN property\b/);
  } finally { done(); }
});

test("a reference to a note that isn't here finds its neighbours by id, and work prefixes are read once a change", () => {
  const { store, done } = scratch("reference-scans");
  try {
    const notes = Array.from({ length: 5 }, (_, i) => store.create(`Seed packet ${i}`));
    const asked = statementsHolding(store, "effective_deleted_root_id IS NULL AND id");
    const missing = "00000000-aaaa-4bbb-8ccc-000000000001";
    const found = store.lookupBlockRef(`((${missing}))`);
    expect(found.kind).toBe("missing");
    expect(asked.length).toBeGreaterThan(0);
    expect(planOf(store, asked[0]!, [missing]).join(" | ")).not.toMatch(/SCAN blocks\b(?! USING)/);
    const prefixes = statementsHolding(store, "SELECT upper(display_address) AS value FROM page_addresses");
    store.workIdAllocatorStatus();
    store.workIdAllocatorStatus();
    expect(prefixes).toHaveLength(1);
    store.update(notes[0]!.id, "Seed packet 0, sorted [work-id::SEED-1]", notes[0]!.revision);
    expect(store.workIdAllocatorStatus().prefixesInUse).toContain("SEED");
  } finally { done(); }
});

test("a whole-outline walk doesn't resolve every note's references (a host's first change, a rule's baseline)", () => {
  const { store, done } = scratch("live-walk");
  try {
    const target = store.create("Rain barrel");
    const source = store.create(`See ((${target.id}))`);
    const walked = store.liveBlocks().find(block => block.id === source.id) as unknown as { displayText?: string };
    expect(walked.displayText).toBe(source.text);
  } finally { done(); }
});

test("a read that goes to another machine doesn't hold what the connection sends after it", async () => {
  const { root, store, done } = scratch("link-read");
  const server = new OutlinerServer(store, join(root, "host.sock"));
  let door: Conn | undefined;
  try {
    const note = store.create("Shed key");
    const release = Promise.withResolvers<void>();
    server.setLinkReader(async request => {
      if (request.action === "references.resolve" || request.action === "pages.resolve" || request.action === "transclusions.read") await release.promise;
      return undefined;
    });
    await server.start();
    // A door's one connection.
    door = new Conn(join(root, "host.sock"), undefined as never);
    const order: string[] = [];
    const remote = [
      door.request({ action: "references.resolve", text: `((${note.id}))` }).then(() => order.push("resolve")),
      door.request({ action: "pages.resolve", address: "away:Shed" }).then(() => order.push("page")),
      door.request({ action: "transclusions.read", targets: [{ blockId: note.id }] }).then(() => order.push("embed")),
    ];
    // The note's other reads, and a save, while the laptop takes its time.
    const asked = await door.request({ action: "children", parentId: note.id }, 1_000);
    const saved = await door.request({ action: "update", blockId: note.id, text: "Shed key, by the door", expectedRevision: note.revision, mutation: { author: "user" } }, 1_000);
    expect({ read: asked.error, save: saved.error, order }).toEqual({ read: undefined, save: undefined, order: [] });
    release.resolve();
    await Promise.all(remote);
    expect(order).toHaveLength(3);
  } finally {
    door?.close();
    await server.close();
    done();
  }
});

test("a machine with a link is asked once, not again as a machine called <name>.link", async () => {
  const root = mkdtempSync(join(tmpdir(), "link-once-"));
  const remote = join(root, ".remote");
  mkdirSync(remote, { recursive: true });
  let lists = 0;
  const far = createServer(socket => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const request = JSON.parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
        if (request.action === "outlines.list") lists += 1;
        const result = request.action === "outlines.list" ? { outlines: [{ name: "away" }] } : { targetBlockId: "x", sources: [], completeness: { kind: "complete" } };
        socket.write(`${JSON.stringify({ id: request.id, ok: true, result, sequence: 1 })}\n`);
      }
    });
  });
  await new Promise<void>(resolve => far.listen(join(remote, "laptop.link.sock"), resolve));
  // What the link does on connecting (machine.ts routeLink): the machine's socket points at the link's.
  symlinkSync(join(remote, "laptop.link.sock"), join(remote, "laptop.sock"));
  const store = new OutlinerStore(join(root, "pie.sqlite"));
  try {
    const target = store.create("Rain barrel");
    const links = new OutlineLinks(() => ["pie"], async () => store, root);
    await links.read("pie", { id: "1", action: "references.backlinks", query: { targetBlockId: target.id, limit: 10 } } as never);
    expect(lists).toBe(1);
    await links.close();
  } finally {
    store.close();
    far.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a stall names the request whose work after a wait held the loop, and its log line counts it (PIE-1567)", async () => {
  const { root, store, done } = scratch("after-a-wait");
  const server = new OutlinerServer(store, join(root, "host.sock"));
  const stalls: LoopStall[] = [];
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: unknown) => { lines.push(String(line)); };
  const watch = watchEventLoop(stall => stalls.push(stall), { sampleMs: 10, reportMs: 40 });
  try {
    const note = store.create("Rain barrel");
    server.setLinkReader(async request => {
      if (request.action !== "references.resolve") return undefined;
      await Bun.sleep(5);
      const started = performance.now();
      while (performance.now() - started < 150) { /* a copy being opened, after the wait */ }
      return undefined;
    });
    await server.start();
    const reader = new OutlinerClient(join(root, "host.sock"));
    await reader.request({ action: "references.resolve", text: `((${note.id}))` });
    await Bun.sleep(30);
    expect(stalls.flatMap(stall => stall.during).find(line => line.startsWith("references.resolve after a wait"))).toBeDefined();
    const row = lines.map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(row => row.status === "slow_request" && row.action === "references.resolve");
    expect(row.loopMs).toBeGreaterThan(80);
    expect(row.who).toBe("a connection");
  } finally {
    console.log = log;
    watch.stop();
    await server.close();
    done();
  }
});

test("a minute's queue reads as actor × action counts, and the deployer's script reads a log of them", async () => {
  const lane = new QueueLane();
  expect(lane.note("moss/claude-code@shed", "create", 1200, "2026-03-04T09:41")).toBeUndefined();
  lane.note("door:garden", "blocks.query", 3400, "2026-03-04T09:41");
  lane.note("door:garden", "blocks.query", 1500, "2026-03-04T09:41");
  const minute = lane.note("ext:echonet", "annotations.list", 1100, "2026-03-04T09:42")!;
  expect(minute).toEqual({
    status: "queued_minute", minute: "2026-03-04T09:41", over1s: 3, worstMs: 3400,
    who: ["door:garden × blocks.query 2 (worst 3400 ms)", "moss/claude-code@shed × create 1 (worst 1200 ms)"],
  });
  const run = async (input: string) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/host-queue-minutes.ts"), "--check"], { stdin: new Blob([input]), stdout: "pipe" });
    return { out: await new Response(child.stdout).text(), code: await child.exited };
  };
  const quiet = await run(`2026-03-04T09:50:01-05:00 host bun[1]: ${JSON.stringify({ status: "loop_stalled", ms: 120, during: [] })}\n`);
  expect(quiet.code).toBe(0);
  expect(quiet.out).toContain("none queued over 1 s");
  const busy = await run(`2026-03-04T09:42:00-05:00 host bun[1]: ${JSON.stringify(minute)}\n`);
  expect(busy.code).toBe(1);
  expect(busy.out).toContain("door:garden × blocks.query 2");
});

test("three doors, agents writing, a slow machine and a restart: nothing queues over a second", async () => {
  // The scenario as a person lives it, on a real host: bench-host-queue reads the host's own log.
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/bench-host-queue.ts"), "--shape", "small", "--phase", "laptop,restart", "--seconds", "4", "--warm", "2", "--check"], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env },
  });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) console.error(out);
  expect(code).toBe(0);
}, 90_000);
