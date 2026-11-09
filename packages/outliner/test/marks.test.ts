// Marks in the service (PIE-1237): one verb every surface calls (`marks.add`, `marks.remove`, `marks.list`), a fact
// written once with unmarking a second fact, the pocket atoms (`marked:today`, `marked-by:`, `marked-since:`) that
// leave an agent's "look here" (a mark with a reason) out, and a `marks` event every client hears, which asks the
// watched questions again. A made-up outline in a scratch store and service per test.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { MarkAddInput, MarkRecord } from "../src/marks";
import type { MutationProvenance, OutlinerEvent, VisibleBlockCollection } from "../src/types";

let root: string;
let store: OutlinerStore;
let server: OutlinerServer;
let client: OutlinerClient;
const socket = () => join(root, "service.sock");
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "marks-"));
  store = new OutlinerStore(join(root, "outline.sqlite"));
  server = new OutlinerServer(store, socket(), undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  client = new OutlinerClient(socket(), 15_000);
});
afterEach(async () => {
  await server.close();
  store.close();
  rmSync(root, { recursive: true, force: true });
});

const until = async (what: string, check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};
const title = (text: string) => text.split("\n")[0]!;
const where = async (query: string) => (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: query, limit: 50 } })).blocks.map(b => title(b.text));
const add = (input: MarkAddInput, mutation?: MutationProvenance) => client.request<{ mark: MarkRecord; already: boolean }>({ action: "marks.add", input, ...(mutation ? { mutation } : {}) });

test("a mark is a fact: the person's, an agent's (attributed), at a given time; a second press answers the same mark", async () => {
  const beans = store.create("Bean poles need tying");
  const shed = store.create("Shed roof leaks");
  const first = await add({ blockId: beans.id, surface: "door" });
  expect(first).toMatchObject({ already: false, mark: { n: 1, block: beans.id, author: "user", by: "user", surface: "door" } });
  expect(await add({ blockId: beans.id })).toMatchObject({ already: true, mark: { n: 1 } });
  const agent = await add({ blockId: shed.id, reason: "needs your call" }, { author: "agent", actorId: "loki/claude-code@float-box" });
  expect(agent.mark).toMatchObject({ n: 2, author: "agent", by: "loki/claude-code@float-box", reason: "needs your call" });
  // An offline share keeps its time.
  const late = await add({ blockId: shed.id, at: "2026-11-01T08:30:00Z", surface: "phone", words: "check before rain" });
  expect(late.mark).toMatchObject({ n: 3, at: "2026-11-01T08:30:00.000Z", words: "check before rain" });
  expect((await client.request<{ marks: MarkRecord[] }>({ action: "marks.list" })).marks.map(m => m.n)).toEqual([1, 2, 3]);
  // Refused with why: no subject, two subjects, a block that isn't there, an agent with no actor id.
  await expect(add({})).rejects.toThrow(/marks one thing/);
  await expect(add({ blockId: beans.id, file: "/tmp/x.md", line: 2 })).rejects.toThrow(/marks one thing/);
  await expect(add({ blockId: "0000dead" })).rejects.toThrow(/no block 0000dead/);
  await expect(add({ blockId: beans.id }, { author: "agent" })).rejects.toThrow(/names its actor id/);
});

test("unmarking is a second fact; a mark on a line of a file; a trashed note's marks rest with it", async () => {
  const beans = store.create("Bean poles need tying");
  const { mark } = await add({ blockId: beans.id });
  const line = await add({ file: "/home/wren/notes/shed.md", line: 12, reason: "check the bed sizes" }, { author: "agent", actorId: "cowboy" });
  expect(line.mark).toMatchObject({ file: "/home/wren/notes/shed.md", line: 12 });
  const removed = await client.request<{ removed: MarkRecord[] }>({ action: "marks.remove", input: { blockId: beans.id } });
  expect(removed.removed.map(m => m.n)).toEqual([mark.n]);
  expect((await client.request<{ removed: MarkRecord[] }>({ action: "marks.remove", input: { blockId: beans.id } })).removed).toEqual([]);
  // The fact stays, with who took it off and when.
  expect(store.database.query("SELECT mark_id, author, actor FROM mark_removals").all()).toEqual([{ mark_id: mark.n, author: "user", actor: "user" }]);
  // Marked again: a new mark, not the old one back.
  expect((await add({ blockId: beans.id })).mark.n).toBe(3);
  store.delete(beans.id);
  expect((await client.request<{ marks: MarkRecord[] }>({ action: "marks.list" })).marks.map(m => m.n)).toEqual([line.mark.n]);
});

test("the atoms read pocket marks: marked:today, marked-by:, marked-since:, and an agent's look-here stays out", async () => {
  const beans = store.create("Bean poles need tying");
  const shed = store.create("Shed roof leaks");
  const gate = store.create("Gate hinge squeaks");
  const compost = store.create("Turn the compost");
  await add({ blockId: beans.id });
  await add({ blockId: shed.id }, { author: "agent", actorId: "loki/claude-code@float-box" });
  await add({ blockId: gate.id, reason: "needs your call" }, { author: "agent", actorId: "loki/claude-code@float-box" });
  await add({ blockId: compost.id, at: new Date(Date.now() - 10 * 86_400_000).toISOString() });
  expect(await where("marked:today")).toEqual(["Bean poles need tying", "Shed roof leaks"]);
  expect(await where("marked:any")).toEqual(["Bean poles need tying", "Shed roof leaks", "Turn the compost"]);
  expect(await where("marked-by:me")).toEqual(["Bean poles need tying", "Turn the compost"]);
  expect(await where("marked-by:loki marked:today")).toEqual(["Shed roof leaks"]);
  expect(await where("marked-since:-7d")).toEqual(["Bean poles need tying", "Shed roof leaks"]);
  // A bare `marked` is still a property: a note that writes [marked::…] matches it, marks or not.
  store.create("Seed packets [marked::yes]");
  expect(await where("marked")).toEqual(["Seed packets [marked::yes]"]);
  await client.request({ action: "marks.remove", input: { blockId: beans.id } });
  expect(await where("marked:today")).toEqual(["Shed roof leaks"]);
});

test("every client hears a mark, and a watched marked:today answers again", async () => {
  const beans = store.create("Bean poles need tying");
  const heard: OutlinerEvent[] = [];
  const connected = Promise.withResolvers<void>();
  const watcher = client.watch({ client: { clientId: "door-b", role: "observer", contextId: "door-b" }, onConnect: () => connected.resolve(), onEvent: e => { heard.push(e); } });
  await connected.promise;
  // A raw connection watching the question, as a door's view does.
  const raw = connect(socket());
  const events: { action: string }[] = [];
  const answers = new Map<string, any>();
  let buffer = "";
  raw.setEncoding("utf8");
  raw.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (line.event) events.push(line.event); else answers.set(line.id, line);
    }
  });
  raw.write(`${JSON.stringify({ id: "w", action: "blocks.query", query: { where: "marked:today" }, watch: "today" })}\n`);
  await until("the watch's first answer", () => answers.has("w"));
  expect(answers.get("w").result.blocks).toEqual([]);
  try {
    await add({ blockId: beans.id, surface: "door" });
    await until("the marks event", () => heard.some(e => e.domain === "marks"));
    expect(heard.find(e => e.domain === "marks")).toMatchObject({ action: "marks.add", blockId: beans.id });
    await until("queries.changed", () => events.some(e => e.action === "queries.changed"));
    // The same press again changes nothing: no second event.
    const count = heard.filter(e => e.domain === "marks").length;
    await add({ blockId: beans.id });
    await Bun.sleep(200);
    expect(heard.filter(e => e.domain === "marks").length).toBe(count);
    await client.request({ action: "marks.remove", input: { blockId: beans.id } });
    await until("the unmark event", () => heard.some(e => e.domain === "marks" && e.action === "marks.remove"));
  } finally {
    raw.destroy();
    await watcher.stop();
  }
});

test("an agent's outline_mark: a pocket mark, a look-here with a reason, and its own marks off again", async () => {
  const { runAgentOperation } = await import("../src/agent-tools");
  const shed = store.create("Shed roof leaks");
  const loki = { actorId: "loki/claude-code@float-box", author: "agent" as const };
  expect(await runAgentOperation(client, "mark", { ref: shed.id }, loki)).toMatchObject({ outcome: "applied", said: expect.stringContaining("marked:today lists it") });
  expect(await runAgentOperation(client, "mark", { ref: shed.id }, loki)).toMatchObject({ outcome: "unchanged" });
  expect(await runAgentOperation(client, "mark", { ref: shed.id, reason: "needs your call" }, loki)).toMatchObject({ outcome: "applied", said: expect.stringContaining("look-here") });
  await add({ blockId: shed.id });
  expect(await where("marked-by:loki")).toEqual(["Shed roof leaks"]);
  // Off again: the agent's own marks only; the person's stays.
  expect(await runAgentOperation(client, "mark", { ref: shed.id, remove: true }, loki)).toMatchObject({ outcome: "applied", marks: [1, 2] });
  expect((await client.request<{ marks: MarkRecord[] }>({ action: "marks.list" })).marks.map(m => m.by)).toEqual(["user"]);
  expect(() => runAgentOperation(client, "mark", { ref: shed.id }, undefined)).toThrow(/--actor/);
});

test("an extension's process marks with its grant, attributed ext:<id> (PIE-1237)", async () => {
  const { issueGrant, revokeGrant } = await import("../src/extension-grants");
  const beans = store.create("Bean poles need tying");
  const grant = issueGrant({ extensionId: "garden-bot", label: "ext.garden-bot.mark", writes: true, secrets: [] });
  try {
    const { mark } = await client.request<{ mark: MarkRecord }>({ action: "marks.add", input: { blockId: beans.id }, grant } as never);
    expect(mark).toMatchObject({ author: "agent", by: "ext:garden-bot" });
    const { removed } = await client.request<{ removed: MarkRecord[] }>({ action: "marks.remove", input: { n: mark.n }, grant } as never);
    expect(removed.map(m => m.n)).toEqual([mark.n]);
    expect(store.database.query("SELECT actor FROM mark_removals").all()).toEqual([{ actor: "ext:garden-bot" }]);
  } finally { revokeGrant(grant); }
});
