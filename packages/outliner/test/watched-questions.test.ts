// ADR 0004 slice 1 (PIE-745): `this`, `linkedfrom:` and `parent:`, groups, facets and hints answered by the service,
// and watched questions told when their answer changed. Fictional outline; a scratch store and service per test.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockQueryError, THIS_MISSING } from "../src/block-query";
import { QueryWatches } from "../src/query-watches";
import { dateBucket, questionFacets } from "../src/question-answer";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, BlockSearchQuery, VisibleBlockCollection } from "../src/types";

let root: string;
let store: OutlinerStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "watched-questions-"));
  store = new OutlinerStore(join(root, "outline.sqlite"));
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

const title = (text: string) => text.split("\n")[0]!.replace(/\s*\[[\w.-]+::[^\]]*\]/g, "").trim();
const ask = (query: BlockSearchQuery) => store.queryBlocks(query);
const titles = (query: BlockSearchQuery) => ask(query).blocks.map(b => title(b.text));

/** A fictional hub: three notes link to it, it links back to one, and it has two children. */
function hub() {
  const hub = store.create("Allotment hub [page::allotment]");
  const shed = store.create("Shed repairs [type::task] [work-stage::doing] [area::shed]");
  const beans = store.create("Bean poles [type::task] [work-stage::queued] [area::beds]");
  const rota = store.create("Watering rota [type::note] [area::beds] [area::paths]");
  store.update(shed.id, `${shed.text}\nfor [[allotment]]`, shed.revision);
  store.update(beans.id, `${beans.text}\nfor [[allotment]]`, beans.revision);
  store.update(rota.id, `${rota.text}\nsee [[allotment]]`, rota.revision);
  store.update(hub.id, `Allotment hub [page::allotment]\nNext: ((${shed.id}))`, hub.revision);
  const gate = store.create("Fix the gate", hub.id);
  const compost = store.create("Turn the compost", hub.id);
  store.create("Under the gate", gate.id);
  return { hub: store.get(hub.id)!, shed, beans, rota, gate, compost };
}

describe("this, linkedfrom: and parent:", () => {
  test("links:this NOT linkedfrom:this is the backlinks the note doesn't link back", () => {
    const s = hub();
    expect(titles({ where: "links:this", this: s.hub.id })).toEqual(["Shed repairs", "Bean poles", "Watering rota"]);
    expect(titles({ where: "linkedfrom:this", this: s.hub.id })).toEqual(["Shed repairs"]);
    expect(titles({ where: "links:this NOT linkedfrom:this", this: s.hub.id })).toEqual(["Bean poles", "Watering rota"]);
    // linkedfrom: by name agrees with links: from the other side.
    expect(titles({ where: "linkedfrom:[[allotment]]" })).toEqual(["Shed repairs"]);
  });

  test("parent: is the direct children; under: stays the subtree", () => {
    const s = hub();
    expect(titles({ where: "parent:this", this: s.hub.id })).toEqual(["Fix the gate", "Turn the compost"]);
    expect(titles({ where: "under:this", this: s.hub.id })).toEqual(["Allotment hub", "Fix the gate", "Under the gate", "Turn the compost"]);
    expect(store.matchQuery("parent:this", [s.gate.id, s.shed.id], { this: s.hub.id }).blockIds).toEqual([s.gate.id]);
  });

  test("a question that says this with none given is refused with what to pass", () => {
    hub();
    expect(() => ask({ where: "links:this" })).toThrow(BlockQueryError);
    expect(() => ask({ where: "links:this" })).toThrow(THIS_MISSING);
    expect(() => store.matchQuery("parent:this", [])).toThrow(THIS_MISSING);
  });
});

describe("groups, sorts, facets and hints", () => {
  test("groups count every match; ids are the returned rows'; a multi-valued property is in each group", () => {
    hub();
    const answer = ask({ where: "area", group: "area", limit: 2 });
    expect(answer.blocks.map(b => title(b.text))).toEqual(["Shed repairs", "Bean poles"]);
    expect(answer.completeness).toEqual({ kind: "truncated", limit: 2, matched: 3 });
    expect(answer.groups!.map(g => [g.value, g.count, g.ids.length])).toEqual([["beds", 2, 1], ["paths", 1, 0], ["shed", 1, 1]]);
    // Matches without the key are a null group, last.
    const byStage = ask({ where: "area", group: "work-stage" });
    expect(byStage.groups!.map(g => [g.value, g.count])).toEqual([["queued", 1], ["doing", 1], [null, 1]]);
  });

  test("work-stage sorts in the workboard's order; title sorts by title; numbers before text either way", () => {
    store.create("Zeta [work-stage::done]");
    store.create("Alpha [work-stage::queued]");
    store.create("Mid [work-stage::doing]");
    expect(titles({ where: "work-stage", sort: "work-stage" })).toEqual(["Alpha", "Mid", "Zeta"]);
    expect(titles({ where: "work-stage", sort: "work-stage desc" })).toEqual(["Zeta", "Mid", "Alpha"]);
    expect(titles({ where: "work-stage", sort: "title" })).toEqual(["Alpha", "Mid", "Zeta"]);
    store.create("Ten [rank::10]");
    store.create("Two [rank::2]");
    store.create("Word [rank::high]");
    expect(titles({ where: "rank", sort: "rank desc" })).toEqual(["Ten", "Two", "Word"]);
  });

  test("date groups bucket by day, ISO week and month, newest first", () => {
    expect(dateBucket("2026-10-09T12:00:00Z", "day")).toBe("2026-10-09");
    expect(dateBucket("2026-10-09T12:00:00Z", "week")).toBe("2026-W41");
    expect(dateBucket("2027-01-01T00:00:00Z", "week")).toBe("2026-W53");
    expect(dateBucket("2026-10-09T12:00:00Z", "month")).toBe("2026-10");
    const old = store.create("Old [kind::x]"), recent = store.create("Recent [kind::x]");
    store.database.query("UPDATE blocks SET created_at = ? WHERE id = ?").run("2026-01-05T10:00:00.000Z", old.id);
    store.database.query("UPDATE blocks SET created_at = ? WHERE id = ?").run("2026-03-05T10:00:00.000Z", recent.id);
    expect(ask({ where: "kind", group: "created:month" }).groups!.map(g => [g.value, g.count])).toEqual([["2026-03", 1], ["2026-01", 1]]);
  });

  test("facets count values over every match; a list asks only those keys", () => {
    hub();
    const all = ask({ where: "area", facets: true, limit: 1 });
    expect(all.facets!.find(f => f.key === "area")).toEqual({ key: "area", count: 3, values: [{ value: "beds", count: 2, last: expect.any(String) }, { value: "paths", count: 1, last: expect.any(String) }, { value: "shed", count: 1, last: expect.any(String) }] });
    expect(all.facets!.map(f => f.key)).toEqual(["area", "type", "work-stage"]);
    expect(ask({ where: "area", facets: ["type"] }).facets).toEqual([{ key: "type", count: 3, values: [{ value: "task", count: 2, last: expect.any(String) }, { value: "note", count: 1, last: expect.any(String) }] }]);
  });

  test("a tags list (PIE-881): tag facets say when each tag was last used, a selection narrows them to the tags that still narrow, and facetValues lists them all", () => {
    const a = store.create("Fence plan #fencing #timber"), b = store.create("Gate #fencing #metal"), c = store.create("Shed roof #roofing");
    store.database.query("UPDATE blocks SET updated_at = ? WHERE id = ?").run("2026-03-05T10:00:00.000Z", a.id);
    store.database.query("UPDATE blocks SET updated_at = ? WHERE id = ?").run("2026-05-05T10:00:00.000Z", b.id);
    store.database.query("UPDATE blocks SET updated_at = ? WHERE id = ?").run("2026-01-05T10:00:00.000Z", c.id);
    const values = (query: Record<string, unknown>) => ask({ facets: ["tag"], ...query }).facets![0]!.values.map(v => `${v.value}:${v.count}:${v.last.slice(0, 7)}`);
    expect(values({ where: "#fencing OR #roofing OR #timber OR #metal" }).sort()).toEqual(["fencing:2:2026-05", "metal:1:2026-05", "roofing:1:2026-01", "timber:1:2026-03"]);
    // #roofing picked: no note carries it with another tag, so none remains to pick; #fencing picked: its notes' other tags.
    expect(values({ where: "#roofing" })).toEqual(["roofing:1:2026-01"]);
    expect(values({ where: "#fencing #timber" })).toEqual(["fencing:1:2026-03", "timber:1:2026-03"].sort());
    expect(values({ where: "#fencing" }).sort()).toEqual(["fencing:2:2026-05", "metal:1:2026-05", "timber:1:2026-03"]);
    // The default lists 50 values a key and says how many it left out; facetValues lifts that.
    for (let i = 0; i < 52; i++) store.create(`Note ${i} #many${String(i).padStart(2, "0")}`);
    const capped = ask({ where: "#many00 OR #many51 OR tag", facets: ["tag"], limit: 1 }).facets![0]!;
    expect([capped.values.length, capped.more]).toEqual([50, expect.any(Number)]);
    expect(ask({ where: "tag", facets: ["tag"], facetValues: 1000, limit: 1 }).facets![0]!.more).toBeUndefined();
    expect(() => ask({ where: "tag", facets: ["tag"], facetValues: 0 })).toThrow(/facetValues/);
  });

  test("facets over any property (PIE-881): a path value matches what is below it with /*, groups and exclusions combine, and facetKeys lifts the key cap", () => {
    store.create("Standup [plot::garden/beds] [week::3]");
    store.create("Retro [plot::garden/paths] [week::5]");
    store.create("Audit [plot::house/shed] [week::9]");
    store.create("Fencing [plot::garden] [week::4]");
    const titles = (where: string) => ask({ where, limit: 50 }).blocks.map(b => b.text.split(" [")[0]).sort();
    expect(titles("plot=garden/*")).toEqual(["Fencing", "Retro", "Standup"]);
    expect(titles("plot=garden")).toEqual(["Fencing"]);
    expect(titles("(plot=garden/* OR plot=house/*) NOT week=3 NOT week=9")).toEqual(["Fencing", "Retro"]);
    for (let i = 0; i < 60; i++) store.create(`Key note ${i} [facetkey${String(i).padStart(2, "0")}::x]`);
    expect(ask({ where: "facetkey00 OR facetkey59", facets: true }).facets!.length).toBeLessThanOrEqual(50);
    expect(ask({ facets: true, facetKeys: 1000, limit: 1 }).facets!.filter(f => f.key.startsWith("facetkey")).length).toBe(60);
    expect(() => ask({ facets: true, facetKeys: 0 })).toThrow(/facetKeys/);
  });

  // PIE-1396: pie (11k notes, 521 keys) took 4.5 s for every key's facets, each key reading every note. Each note is
  // read once now, for the keys it carries: the work grows with what notes hold, not notes times keys.
  test("every key's facets read each note once, for the keys it carries; a tag facet still counts tags", () => {
    type Fake = Block & { keys: string[] };
    const blocks = Array.from({ length: 400 }, (_, i) => ({ id: `b${i}`, updatedAt: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, keys: [`k${i % 200}`, "type", ...(i % 2 ? ["tags"] : ["tag"])] }) as unknown as Fake);
    let reads = 0;
    const valuesOf = (block: Block, key: string) => {
      reads += 1;
      return (block as Fake).keys.filter(k => k === key || key === "tag" && k === "tags").map(k => k === "type" ? "note" : `${k}-v`);
    };
    const facets = questionFacets(blocks, true, valuesOf, block => (block as Fake).keys, 50, 300);
    expect(reads).toBeLessThanOrEqual(400 * 4);
    expect(facets.find(f => f.key === "type")).toMatchObject({ count: 400, values: [{ value: "note", count: 400, last: "2026-10-28" }] });
    // `tag` reads `tags` too (block-query's rule); `tags` reads only itself.
    expect(facets.find(f => f.key === "tag")).toMatchObject({ count: 400, values: [{ value: "tag-v", count: 200 }, { value: "tags-v", count: 200 }] });
    expect(facets.find(f => f.key === "tags")).toMatchObject({ count: 200 });
    expect(facets.length).toBe(203);
    expect(facets.slice(0, 2).map(f => f.key)).toEqual(["tag", "type"]);
  });

  test("a key nobody carries is a hint with the nearest keys; a known key with no matches isn't", () => {
    hub();
    expect(ask({ where: "aera=beds" }).hint).toMatch(/^no notes have aera; nearest: area, /);
    expect(ask({ where: "type", group: "stagee" }).hint).toMatch(/^no notes have stagee; nearest: /);
    const none = ask({ where: "area=moon" });
    expect([none.blocks.length, none.hint]).toEqual([0, undefined]);
  });
});

/** A raw connection to the service: requests by id, and the events it is sent. */
function rawClient(socketPath: string) {
  const socket = connect(socketPath);
  const events: { action: string; changes?: { key: string; generation: number; dropped?: true }[] }[] = [];
  const waiting = new Map<string, (r: { ok: boolean; result?: any; error?: string }) => void>();
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (line.event) events.push(line.event);
      else waiting.get(line.id)?.(line);
    }
  });
  let n = 0;
  const request = (body: object) => new Promise<{ ok: boolean; result?: any; error?: string }>(resolve => {
    const id = `r${++n}`;
    waiting.set(id, resolve);
    socket.write(`${JSON.stringify({ id, ...body })}\n`);
  });
  return { socket, events, request };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(20);
  }
};

describe("watched questions", () => {
  test("the answer that registers is generation 0; a change sends queries.changed to that connection alone; the newest is kept", async () => {
    const s = hub();
    const server = new OutlinerServer(store, join(root, "service.sock"));
    await server.start();
    const watcher = rawClient(join(root, "service.sock")), other = rawClient(join(root, "service.sock"));
    try {
      const question = { action: "blocks.query", query: { where: "links:this NOT linkedfrom:this", this: s.hub.id, group: "area" }, watch: "loose" };
      const first = await watcher.request(question);
      expect(first.ok).toBe(true);
      expect(first.result.generation).toBe(0);
      expect(first.result.blocks.map((b: { text: string }) => title(b.text))).toEqual(["Bean poles", "Watering rota"]);
      // Another connection's write that doesn't change the answer says nothing.
      await other.request({ action: "create", text: "Unrelated" });
      await Bun.sleep(400);
      expect(watcher.events.filter(e => e.action === "queries.changed")).toEqual([]);
      // The hub links back to the beans: the answer changes.
      const now = store.get(s.hub.id)!;
      await other.request({ action: "update", blockId: s.hub.id, text: `${now.text}\nand ((${s.beans.id}))`, expectedRevision: now.revision });
      await until(() => watcher.events.some(e => e.action === "queries.changed"));
      const changed = watcher.events.find(e => e.action === "queries.changed")!;
      expect(changed.changes).toEqual([{ key: "loose", generation: 1 }]);
      expect(other.events.some(e => e.action === "queries.changed")).toBe(false);
      // Asked with that generation, it's the kept answer.
      const second = await watcher.request({ ...question, generation: 1 });
      expect([second.result.generation, second.result.blocks.map((b: { text: string }) => title(b.text))]).toEqual([1, ["Watering rota"]]);
      // An older generation is answered with the newest.
      expect((await watcher.request({ ...question, generation: 0 })).result.generation).toBe(1);
      // A refused question isn't kept.
      expect((await watcher.request({ action: "blocks.query", query: { where: "links:this" }, watch: "bad" })).error).toContain("this is the note");
      expect(server.watches.size).toBe(1);
    } finally {
      watcher.socket.destroy(); other.socket.destroy();
      await until(() => server.watches.size === 0);
      await server.close();
    }
  });

  test("views.read and the links reads are watched too", async () => {
    const s = hub();
    const view = store.create("Beds view [type::virtual-branch] [query::area=beds]");
    const server = new OutlinerServer(store, join(root, "service.sock"));
    await server.start();
    const watcher = rawClient(join(root, "service.sock"));
    try {
      expect((await watcher.request({ action: "views.read", viewId: view.id, watch: "view" })).result.generation).toBe(0);
      expect((await watcher.request({ action: "references.backlinks", query: { targetBlockId: s.hub.id, limit: 50 }, watch: "back" })).result.generation).toBe(0);
      store.create("Path edging [area::beds]\nfor [[allotment]]");
      server.watches.changed();
      await until(() => watcher.events.some(e => e.action === "queries.changed"));
      expect(watcher.events.flatMap(e => e.changes ?? []).map(c => c.key).sort()).toEqual(["back", "view"]);
    } finally {
      watcher.socket.destroy();
      await server.close();
    }
  });
});

describe("the watch registry", () => {
  const conn = () => ({ lines: [] as string[], write(line: string) { this.lines.push(line); } });
  const changesOf = (c: { lines: string[] }) => c.lines.map(l => JSON.parse(l).event.changes);

  test("past 64 per connection and 512 per service the oldest is dropped and told", () => {
    let value = 0;
    const watches = new QueryWatches({ answer: r => ({ id: r.id, ok: true, result: { value }, sequence: 1 }), sequence: () => 1, perConnection: 2, perService: 3 });
    const a = conn(), b = conn();
    for (const key of ["a1", "a2", "a3"]) watches.ask(a, { id: "x", action: "blocks.query", query: { key }, watch: key });
    expect(changesOf(a)).toEqual([[{ key: "a1", generation: 0, dropped: true }]]);
    watches.ask(b, { id: "x", action: "blocks.query", query: {}, watch: "b1" });
    watches.ask(b, { id: "x", action: "blocks.query", query: {}, watch: "b2" });
    expect(changesOf(a)[1]).toEqual([{ key: "a2", generation: 0, dropped: true }]);
    expect(watches.size).toBe(3);
    value = 1;
    watches.flush();
    expect(changesOf(b)).toEqual([[{ key: "b1", generation: 1 }, { key: "b2", generation: 1 }]]);
    watches.closed(b);
    expect(watches.size).toBe(1);
    watches.stop();
  });

  test("changes coalesce: one pass after the burst settles, and one at least every maxWaitMs under steady writes", async () => {
    let passes = 0;
    const watches = new QueryWatches({ answer: r => { passes += r.id === "watch" ? 1 : 0; return { id: r.id, ok: true, result: {}, sequence: 1 }; }, sequence: () => 1, settleMs: 40, maxWaitMs: 100 });
    watches.ask(conn(), { id: "x", action: "blocks.query", query: {}, watch: "k" });
    const started = Date.now();
    while (Date.now() - started < 250) { watches.changed(); await Bun.sleep(10); }
    expect(passes).toBeGreaterThanOrEqual(2);
    expect(passes).toBeLessThanOrEqual(3);
    const before = passes;
    watches.changed(); watches.changed();
    await Bun.sleep(80);
    expect(passes).toBe(before + 1);
    watches.stop();
  });
});

test("blocks.query answers rows with their revision and properties", () => {
  const s = hub();
  const answer: VisibleBlockCollection = ask({ where: "parent:this", this: s.hub.id });
  expect(answer.blocks.every(b => typeof b.revision === "number" && Array.isArray(b.properties))).toBe(true);
});
