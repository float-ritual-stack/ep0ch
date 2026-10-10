// Conversations in the margin: a thread is one conversation (the first @margin starts a session, kept on the thread; a
// later @margin there resumes it, so the agent remembers), a reply without @margin is never sent, the agent sees the
// whole thread and the page's other comments, a query it suggests is checked, and the reader's threads come back in
// Recent replies (`thread:me`, `unread:me` over read marks, cleared by `annotations.read`). Also the views' counted
// `child>=N:` (a hub is a block with two or more views under it). Scratch services in temp folders; a made-up model
// (a script that remembers each session in a file); the notes are made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RECENT_REPLIES_QUERY, UNREAD_REPLIES_QUERY, recentRepliesView } from "@ep0ch/outline-core/recent-replies";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { AnnotationBatchReceipt, AnnotationThread, VisibleBlockCollection } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until<T>(what: string, check: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(25);
  }
}

/**
 * A made-up model with claude's session flags: `--session-id <id>` starts one, `--resume <id>` continues it (refused
 * when it doesn't know the id). It answers with the turn, the first question it was asked in the session, and what it
 * was shown.
 */
const FAKE_MODEL = `
const [dir, flag, id] = process.argv.slice(2);
const prompt = await Bun.stdin.text();
const file = dir + "/" + id + ".json";
const fs = require("node:fs");
if (flag === "--resume" && !fs.existsSync(file)) { console.error("no conversation " + id); process.exit(1); }
const memory = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { asked: [] };
const question = (/THE QUESTION: (.*)/.exec(prompt) || [])[1] || "?";
memory.asked.push(question);
fs.writeFileSync(file, JSON.stringify(memory));
const saw = [prompt.includes("THE PAGE'S OTHER COMMENTS") ? "other comments" : "", prompt.includes("note to self") ? "the aside" : ""].filter(Boolean).join(", ");
const query = question.includes("view") ? " Try [query::type=chore AND area=garden] or [query::kind=ask] [sort::modified desc]." : "";
console.log("turn " + memory.asked.length + "; first you asked: " + memory.asked[0] + (saw ? "; I saw " + saw : "") + "." + query);
`;

const PLAN = "Greenhouse plan for the spring\nWater the tomatoes at dawn, before the glass warms.\nKeep the soil pH near 6.5 for the peppers.";

async function setup(model = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-margin-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  const kit = join(outline, "extensions", "marginalia");
  mkdirSync(join(outline, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "marginalia"), kit, { recursive: true });
  const memory = join(root, "model");
  mkdirSync(memory);
  writeFileSync(join(root, "model.ts"), FAKE_MODEL);
  if (model) {
    writeFileSync(join(kit, "config.json"), JSON.stringify({ config: {
      answer: [process.execPath, join(root, "model.ts"), memory],
      session: { start: ["--session-id", "{id}"], resume: ["--resume", "{id}"] },
    } }));
  }
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: outline });
  const socket = join(root, "outliner.sock");
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80 });
  await server.start();
  const client = new OutlinerClient(socket, 15_000);
  cleanups.push(async () => {
    await server.close();
    store.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });
  await client.request({ action: "extensions.list", reload: true });
  const note = store.create(PLAN, null, "user");
  const threads = () => client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: note.id }, includeResolved: true } });
  const comment = async (requestId: string, quote: string, body: string) => (await client.request<AnnotationBatchReceipt>({
    action: "annotations.batch", requestId, author: "user",
    operations: [{ operationId: "c", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body, source: "user", passage: { quote, start: note.text.indexOf(quote) } } }],
  })).annotations[0]!.block.id;
  const reply = (requestId: string, annotationId: string, body: string) =>
    client.request<AnnotationBatchReceipt>({ action: "annotations.reply", requestId, author: "user", input: { annotationId, body, source: "user" } });
  const answers = async (id: string) => (await threads()).find(t => t.block.id === id)!.replies.filter(r => r.block.actorId === "ext:marginalia");
  const ids = async (where: string) => (await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, limit: 100 } })).blocks.map(b => b.id);
  return { store, client, note, threads, comment, reply, answers, ids, memory };
}

test("a margin thread is one conversation: @margin resumes its session, a reply without it is a note to self, and the agent sees the thread and the page", async () => {
  const { comment, reply, answers, threads, memory } = await setup();
  // Another comment on the page, which every answer is shown.
  await comment("other", "peppers", "The peppers went in late this year.");
  const id = await comment("ask", "tomatoes at dawn", "@margin why dawn?");
  const first = await until("the first answer", async () => (await answers(id))[0]);
  expect(first.body).toBe("turn 1; first you asked: why dawn?; I saw other comments.");
  // Its session is kept on the thread.
  const session = (await threads()).find(t => t.block.id === id)!.properties!["margin-session"]![0]!;
  expect(JSON.parse(readFileSync(join(memory, `${session}.json`), "utf8")).asked).toEqual(["why dawn?"]);
  // A reply with no @margin is never sent.
  await reply("aside", id, "note to self: check the vent on Sunday");
  await Bun.sleep(400);
  expect(await answers(id)).toHaveLength(1);
  // @margin in a reply resumes the session: the model remembers the first question, and saw the aside in the thread.
  await reply("again", id, "@margin and in winter?");
  const second = await until("the second answer", async () => (await answers(id))[1]);
  expect(second.body).toBe("turn 2; first you asked: why dawn?; I saw other comments, the aside.");
  expect((await threads()).find(t => t.block.id === id)!.properties!["margin-session"]).toEqual([session]);
});

test("a session that can't be resumed starts again with the whole thread; a suggested query that doesn't work is marked under the answer", async () => {
  const { comment, reply, answers, threads, memory, store } = await setup();
  const id = await comment("ask", "soil pH", "@margin what pH?");
  await until("the first answer", async () => (await answers(id))[0]);
  const session = (await threads()).find(t => t.block.id === id)!.properties!["margin-session"]![0]!;
  rmSync(join(memory, `${session}.json`));
  store.create("Dig the bed [type::chore] [area::garden]", null, "user");
  await reply("again", id, "@margin which view lists the chores?");
  const second = await until("the second answer", async () => (await answers(id))[1]);
  expect(second.body).toStartWith("turn 1; first you asked: which view lists the chores?");
  expect((await threads()).find(t => t.block.id === id)!.properties!["margin-session"]![0]).not.toBe(session);
  // The working query passes; kind (no note has it) and a sort by a key nobody wrote are said, with the nearest keys.
  expect(second.body).toContain("⚠ checked with the outline:");
  expect(second.body).not.toContain("[query::type=chore AND area=garden]:");
  expect(second.body).toMatch(/\[query::kind=ask\]: no notes have kind/);
  expect(second.body).toMatch(/\[sort::modified desc\]: no notes have modified/);
});

test("Recent replies: replies on the reader's threads, not their own; unread until the thread is read, and again when a new reply lands", async () => {
  const { client, comment, reply, ids, store, note } = await setup(false);
  const mine = await comment("mine", "tomatoes at dawn", "Dawn, or before?");
  // An agent's thread he never wrote in stays out; one he replied in comes in.
  const theirs = (await client.request<AnnotationBatchReceipt>({
    action: "annotations.batch", requestId: "theirs", author: "agent", provenance: { actorId: "fern" },
    operations: [{ operationId: "c", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "Check the peppers.", source: "agent", passage: { quote: "peppers", start: note.text.indexOf("peppers") } } }],
  })).annotations[0]!.block.id;
  const agentReply = async (requestId: string, annotationId: string, body: string) => (await client.request<AnnotationBatchReceipt>({
    action: "annotations.reply", requestId, author: "agent", provenance: { actorId: "fern" }, input: { annotationId, body, source: "agent" },
  })).annotations[0]!.block.id;
  const onMine = await agentReply("a1", mine, "Before: the glass warms fast.");
  const onTheirs = await agentReply("a2", theirs, "Done, they're fine.");
  const self = (await reply("self", mine, "ok")).annotations[0]!.block.id;
  expect(await ids(RECENT_REPLIES_QUERY)).toEqual([onMine]);
  await reply("joined", theirs, "Thanks!");
  expect((await ids(RECENT_REPLIES_QUERY)).sort()).toEqual([onMine, onTheirs].sort());
  expect(await ids(RECENT_REPLIES_QUERY)).not.toContain(self);
  expect((await ids(UNREAD_REPLIES_QUERY)).sort()).toEqual([onMine, onTheirs].sort());
  // Opening a thread reads it (by its id or a reply's).
  expect(await client.request<{ thread: string; marked: number }>({ action: "annotations.read", annotationId: onMine })).toEqual({ thread: mine, marked: 3 });
  expect(await ids(UNREAD_REPLIES_QUERY)).toEqual([onTheirs]);
  // A new reply is unread again; an agent's own read marks are its own.
  const later = await agentReply("a3", mine, "And shade the south pane.");
  expect((await ids(UNREAD_REPLIES_QUERY)).sort()).toEqual([later, onTheirs].sort());
  await client.request({ action: "annotations.read", annotationId: mine, reader: "fern" });
  expect(await ids(`${RECENT_REPLIES_QUERY} AND unread:fern`)).toEqual([onTheirs]);
  // The saved view asks the same, newest first.
  const view = store.create(recentRepliesView(), null, "user");
  const read = await client.request<{ blocks: { id: string }[] }>({ action: "views.read", viewId: view.id });
  expect(read.blocks.map(b => b.id)).toEqual([later, onTheirs, onMine]);
  // A reader that isn't one is refused with what to write.
  await expect(ids("unread:[[x]]")).rejects.toThrow(/names no reader: write unread:me/);
});

test("a hub is a block with two or more views under it: child>=2: counts the children that have the property", async () => {
  const { store, ids } = await setup(false);
  const hub = store.create("Garden hub", null, "user");
  store.create("Chores [type::virtual-branch] [query::type=chore]", hub.id, "user");
  store.create("Seeds [type::virtual-branch] [query::type=seed]", hub.id, "user");
  const one = store.create("Shed", null, "user");
  store.create("Tools [type::virtual-branch] [query::type=tool]", one.id, "user");
  const tagged = store.create("Old hub [type::hub]", null, "user");
  // (The scratch outline's own pages have views under them too: only these notes are looked at.)
  const mine = async (where: string) => (await ids(where)).filter(id => [hub.id, one.id, tagged.id].includes(id)).sort();
  expect(await mine("child>=2:type=virtual-branch")).toEqual([hub.id]);
  expect(await mine("child:type=virtual-branch")).toEqual([hub.id, one.id].sort());
  expect(await mine("type=hub OR child>=2:type=virtual-branch")).toEqual([hub.id, tagged.id].sort());
  await expect(ids("child>=0:type=virtual-branch")).rejects.toThrow(/needs N of 1 or more/);
});
