// PIE-1546: tools' bookkeeping writes (notes stamped `[machine::…]`: write-review records, health samples) came about
// once a second, and each one evaluated every watched question again, though a question that leaves machinery out
// (every reader's default) can't see them. The door's own reads queued behind those passes for seconds.
// Fictional outline; a scratch store and service per test.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueryWatches } from "../src/query-watches";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { machineryBlind } from "../src/watch-machinery";

let root: string;
let store: OutlinerStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "watch-machinery-"));
  store = new OutlinerStore(join(root, "outline.sqlite"));
});
afterEach(() => {
  store.close();
  rmSync(root, { recursive: true, force: true });
});

function rawClient(socketPath: string) {
  const socket = connect(socketPath);
  const events: { action: string; changes?: { key: string; generation: number }[] }[] = [];
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

/** A made-up allotment board: tickets in stages, notes, a waiting list, and a Records page tools write under. */
function allotment(tickets = 600) {
  const stages = ["queued", "doing", "review", "validate", "done"];
  const areas = ["beds", "shed", "paths", "compost", "pond"];
  for (let i = 0; i < tickets; i++) {
    store.create(`Ticket ${i} [type::roadmap-item] [work-stage::${stages[i % 5]}] [area::${areas[i % 5]}]${i % 7 === 0 ? " [needs::sysop: pick a seed]" : ""}\nfor [[allotment]]`);
  }
  for (let i = 0; i < 300; i++) store.create(`Note ${i} [type::note] [area::${areas[i % 5]}]`);
  const records = store.create("Records [page::records] [machine::record]");
  const board = store.create("Doing [type::virtual-branch] [query::type=roadmap-item AND work-stage=doing]");
  return { records, board };
}

/** The questions a door watches on a board and its status bar (made up, shaped like the real ones). */
const doorQuestions = (board: string) => [
  ...["queued", "doing", "review", "validate", "done"].map(stage => ({ action: "blocks.query", query: { where: `type=roadmap-item AND work-stage=${stage}`, limit: 50 } })),
  { action: "blocks.query", query: { where: "needs", propertyScope: "all", limit: 30 } },
  { action: "blocks.query", query: { where: "type=roadmap-item", group: "work-stage", limit: 1 } },
  { action: "blocks.query", query: { where: "updated >= -1d", sort: { field: "updated", direction: "desc" }, limit: 20 } },
  ...["beds", "shed", "paths", "compost", "pond"].map(area => ({ action: "blocks.query", query: { where: `area=${area}`, limit: 40 } })),
  { action: "views.read", viewId: board },
];

describe("machinery writes and watched questions (PIE-1546)", () => {
  test("a burst of records stamped [machine::record] evaluates no question that leaves machinery out; a door's read waits under a second", async () => {
    const { records, board } = allotment();
    const server = new OutlinerServer(store, join(root, "service.sock"));
    await server.start();
    // Count the watch evaluations: QueryWatches answers through the service's own handle, with the id "watch".
    let evaluations = 0;
    const handle = server.handle.bind(server);
    (server as { handle: typeof server.handle }).handle = (request => {
      if (request.id === "watch") evaluations += 1;
      return handle(request);
    }) as typeof server.handle;
    const door = rawClient(join(root, "service.sock")), tool = rawClient(join(root, "service.sock"));
    try {
      const questions = doorQuestions(board.id);
      for (const [i, question] of questions.entries()) expect((await door.request({ ...question, watch: `w${i}` })).ok).toBe(true);
      expect(server.watches.size).toBe(questions.length);
      // 20 records, as fast as Jev's write review and the sysop look write them on a busy evening.
      let slowest = 0;
      for (let i = 0; i < 20; i++) {
        expect((await tool.request({ action: "create", text: `review-quiet ${i} [machine::record] [record::review-quiet]`, parentId: records.id, author: "agent" })).ok).toBe(true);
        const asked = performance.now();
        expect((await door.request({ action: "blocks.query", query: { where: "type=roadmap-item AND work-stage=review", limit: 50 } })).ok).toBe(true);
        slowest = Math.max(slowest, performance.now() - asked);
        await Bun.sleep(60);
      }
      // Past the settle and the once-a-second floor: every pass that was coming has come.
      await Bun.sleep(1300);
      expect(evaluations).toBe(0);
      expect(door.events.filter(e => e.action === "queries.changed")).toEqual([]);
      expect(slowest).toBeLessThan(1000);
      // A person's write still reaches the questions it may change.
      await tool.request({ action: "create", text: "Ticket new [type::roadmap-item] [work-stage::doing] [area::beds]" });
      const until = Date.now() + 3000;
      while (!door.events.some(e => e.action === "queries.changed") && Date.now() < until) await Bun.sleep(20);
      const keys = door.events.flatMap(e => e.changes ?? []).map(c => c.key);
      // The stage count and the board view hold it (the doing list is past its limit of 50).
      expect(keys).toContain("w6");
      expect(keys).toContain(`w${questions.length - 1}`);
      expect(evaluations).toBeGreaterThan(0);
    } finally {
      door.socket.destroy(); tool.socket.destroy();
      await server.close();
    }
  });
});

describe("what a stamped note's change still reaches (PIE-1546 review)", () => {
  async function served() {
    const server = new OutlinerServer(store, join(root, "service.sock"));
    await server.start();
    const door = rawClient(join(root, "service.sock")), tool = rawClient(join(root, "service.sock"));
    const changed = async (key: string) => {
      const until = Date.now() + 3000;
      while (!door.events.some(e => e.action === "queries.changed" && e.changes?.some(c => c.key === key)) && Date.now() < until) await Bun.sleep(20);
      return door.events.some(e => e.action === "queries.changed" && e.changes?.some(c => c.key === key));
    };
    return { server, door, tool, changed, close: async () => { door.socket.destroy(); tool.socket.destroy(); await server.close(); } };
  }

  test("a note stamped [machine::…] leaves a count it wasn't listed in", async () => {
    const a = store.create("Seed tray A [type::tray] [area::shed]");
    store.create("Seed tray B [type::tray] [area::shed]");
    const s = await served();
    try {
      // Grouped, one row listed: tray A counts in the group but isn't on the page.
      const asked = await s.door.request({ action: "blocks.query", query: { where: "type=tray", group: "area", limit: 1, sort: { field: "created", direction: "desc" } }, watch: "count" });
      expect(asked.result.groups[0].count).toBe(2);
      expect(asked.result.blocks.map((b: { id: string }) => b.id)).not.toContain(a.id);
      const now = store.get(a.id)!;
      await s.tool.request({ action: "update", blockId: a.id, text: `${now.text} [machine::record]`, expectedRevision: now.revision, mutation: { author: "agent", actorId: "keeper" } });
      expect(await s.changed("count")).toBe(true);
      expect((await s.door.request({ action: "blocks.query", query: { where: "type=tray", group: "area", limit: 1, sort: { field: "created", direction: "desc" } }, watch: "count" })).result.groups[0].count).toBe(1);
    } finally { await s.close(); }
  });

  test("a question that reads other notes (child:) sees a stamped child", async () => {
    const bed = store.create("Bean bed [type::bed]");
    const s = await served();
    try {
      expect((await s.door.request({ action: "blocks.query", query: { where: "type=bed AND child:status=open" }, watch: "open" })).result.blocks).toEqual([]);
      await s.tool.request({ action: "create", text: "watering due [status::open] [machine::record]", parentId: bed.id, author: "agent" });
      expect(await s.changed("open")).toBe(true);
    } finally { await s.close(); }
  });
});

describe("which watches a machinery change reaches", () => {
  const conn = () => ({ lines: [] as string[], write(line: string) { this.lines.push(line); } });
  /** A registry over a fake service: `blind` says the question leaves machinery out, listing `members`. */
  function registry() {
    const asked: string[] = [];
    const watches = new QueryWatches({
      answer: request => { asked.push(String(request.watchName ?? (request.query as { key?: string })?.key)); return { id: request.id, ok: true, result: { blocks: [] }, sequence: 1 }; },
      sequence: () => 1,
      settleMs: 1,
      machineryBlind: request => (request.query as { blind?: string[] })?.blind ? new Set((request.query as { blind: string[] }).blind) : undefined,
    });
    return { watches, asked };
  }

  test("a stamped note's change skips the blind questions, unless one lists it (or its parent); a plain change reaches all", () => {
    const { watches, asked } = registry();
    const c = conn();
    watches.ask(c, { id: "x", action: "blocks.query", watch: "blind", query: { key: "blind", blind: ["listed"] } });
    watches.ask(c, { id: "x", action: "blocks.query", watch: "shows", query: { key: "shows" } });
    asked.length = 0;
    watches.changed({ blockId: "record-1", parentId: "records", machinery: true });
    watches.flush();
    expect(asked).toEqual(["shows"]);
    asked.length = 0;
    // The note it lists was stamped (or a stamped note went under a note it lists): it may drop out, so it's asked.
    watches.changed({ blockId: "listed", parentId: "records", machinery: true });
    watches.flush();
    expect(asked.sort()).toEqual(["blind", "shows"]);
    asked.length = 0;
    watches.changed({ blockId: "record-2", parentId: "listed", machinery: true });
    watches.flush();
    expect(asked.sort()).toEqual(["blind", "shows"]);
    asked.length = 0;
    // One plain change in the burst: everything, as before.
    watches.changed({ blockId: "record-3", parentId: "records", machinery: true });
    watches.changed({ blockId: "a-note", parentId: null });
    watches.flush();
    expect(asked.sort()).toEqual(["blind", "shows"]);
    watches.stop();
  });

  test("the service says which of its questions leave machinery out", async () => {
    const { records } = allotment(10);
    store.create("review-quiet 1 [machine::record] [record::review-quiet]", records.id, "agent");
    const server = new OutlinerServer(store, join(root, "service.sock"));
    const blind = (request: Record<string, unknown>) => {
      const response = server.handle({ id: "q", ...request } as never);
      return machineryBlind(store, request, response);
    };
    try {
      // The default (hide) is blind; it names what it lists and the note the question is about.
      const listed = blind({ action: "blocks.query", query: { where: "type=note", this: records.id, limit: 3 } });
      expect(listed?.size).toBe(4);
      expect(listed?.has(records.id)).toBe(true);
      expect(blind({ action: "blocks.query", query: { where: "type=note", machinery: "show" } })).toBeUndefined();
      expect(blind({ action: "blocks.query", query: { where: "machine=record" } })).toBeUndefined();
      expect(blind({ action: "blocks.query", query: { where: "type=note", machinery: "hide", countMachinery: true } })).toBeUndefined();
      // A question that finds nothing says how many machinery notes it left out: their count changes with them.
      expect(blind({ action: "blocks.query", query: { where: "record" } })).toBeUndefined();
      const view = store.create("Notes [type::virtual-branch] [query::type=note]");
      expect(blind({ action: "views.read", viewId: view.id })?.has(view.id)).toBe(true);
      const shows = store.create("Records too [type::virtual-branch] [query::type=note] [machinery::show]");
      expect(blind({ action: "views.read", viewId: shows.id })).toBeUndefined();
      expect(blind({ action: "references.backlinks", query: { targetBlockId: records.id, limit: 5 } })).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});

// Round two (PIE-1546): what a door asked after every change. Its lists are watched reads now, blind to machinery, and a
// tile's drawing (a script run that takes a second or more) no longer holds the rest of its connection behind it.
describe("a door's lists and drawings (PIE-1546, round two)", () => {
  test("the waiting asks are watched: a tool's bookkeeping evaluates nothing and is said hidden; a new ask is told", async () => {
    const records = store.create("Records [page::records] [machine::record]");
    store.create("Which compost bin? [type::task] [needs::sysop: which bin?]");
    const server = new OutlinerServer(store, join(root, "service.sock"));
    await server.start();
    let evaluations = 0;
    const handle = server.handle.bind(server);
    (server as { handle: typeof server.handle }).handle = (request => {
      if (request.id === "watch" && request.action === "waiting.list") evaluations += 1;
      return handle(request);
    }) as typeof server.handle;
    const door = rawClient(join(root, "service.sock")), tool = rawClient(join(root, "service.sock")), sub = rawClient(join(root, "service.sock"));
    try {
      // The door's event connection, as SocketBoard.subscribe opens it.
      expect((await sub.request({ action: "events.subscribe", client: { clientId: "door-1", role: "observer", contextId: "door-1", app: "door" } })).ok).toBe(true);
      const first = await door.request({ action: "waiting.list", watch: "asks" });
      expect(first.result.map((r: { reason: string }) => r.reason)).toEqual(["which bin?"]);
      for (let i = 0; i < 5; i++) await tool.request({ action: "create", text: `soil sample ${i} [machine::record]`, parentId: records.id, author: "agent" });
      await Bun.sleep(1300);
      expect(evaluations).toBe(0);
      const content = sub.events.filter((e: any) => e.action === "create");
      expect(content.length).toBe(5);
      expect(content.every((e: any) => e.hidden === true)).toBe(true);
      await tool.request({ action: "create", text: "Lime or not? [type::task] [needs::sysop: lime?]", author: "user" });
      const until = Date.now() + 3000;
      while (!door.events.some(e => e.changes?.some(c => c.key === "asks")) && Date.now() < until) await Bun.sleep(20);
      expect(door.events.some(e => e.changes?.some(c => c.key === "asks"))).toBe(true);
      expect(sub.events.filter((e: any) => e.action === "create" && !e.hidden).length).toBe(1);
    } finally {
      door.socket.destroy(); tool.socket.destroy(); sub.socket.destroy();
      await server.close();
    }
  });

  test("a tile's drawing that takes a second holds none of its connection's other requests", async () => {
    const server = new OutlinerServer(store, join(root, "service.sock"));
    await server.start();
    // A script's drawing that runs long off the loop, as the what-changed tile's did on pie (1 to 6 s).
    (server.scriptRuns as unknown as { format: () => Promise<unknown> }).format = async () => { await Bun.sleep(1200); return { markdown: "drawn", reads: [], queries: [] }; };
    const door = rawClient(join(root, "service.sock"));
    try {
      const started = performance.now();
      const drawing = door.request({ action: "scripts.render", of: "what-changed", props: {}, deadlineMs: 5000 }).then(() => performance.now() - started);
      const held = await door.request({ action: "agents.held" }).then(r => { expect(r.ok).toBe(true); return performance.now() - started; });
      expect(held).toBeLessThan(500);
      expect(await drawing).toBeGreaterThan(1100);
    } finally {
      door.socket.destroy();
      await server.close();
    }
  });
});
