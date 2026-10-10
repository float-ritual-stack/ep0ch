// The passage target and marginalia's kit (ADR 0004 contracts 5 and 6, PIE-751 and PIE-753): an action on a passage
// is checked before it runs (exact at its revision, found once with its context at a newer one, refused with the
// nearest match otherwise), annotates the words with open properties, never edits a Resource, and `@margin` in a
// person's comment on a passage is answered in its thread. Scratch services in temp folders; the notes are made up.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { passageAt, type Passage } from "@ep0ch/outline-core/passage";
import { OutlinerClient } from "../src/client";
import type { ExtensionsListResult } from "../src/extension-registry";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { AnnotationBatchReceipt, AnnotationThread, Block } from "../src/types";

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

const PLAN = [
  "Greenhouse plan for the spring",
  "Water the tomatoes at dawn, before the glass warms. ^water",
  "Keep the soil pH near 6.5 for the peppers.",
  "",
  "Glossary",
  "- **soil pH**: how acid or sweet the soil is, from 0 to 14; 7 is neutral.",
  "- cold frame — a low glass box that hardens seedlings off.",
].join("\n");

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-passage-")));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const outline = join(root, "outline");
  mkdirSync(join(outline, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "marginalia"), join(outline, "extensions", "marginalia"), { recursive: true });
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
  const list = await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });
  const note = store.create(PLAN, null, "user");
  const passage = (b: Block, quote: string): Passage => { const at = b.text.indexOf(quote); return passageAt(b.text, at, at + quote.length, b.id, b.revision); };
  const act = <T = { written: string[]; message?: string; copy?: string; passage?: Passage }>(action: string, p: Passage, extra: Record<string, unknown> = {}) =>
    client.request<T>({ action: "extensions.act", extension: "marginalia", extensionAction: action, passage: p, mutation: { author: "user" }, ...extra });
  const threads = () => client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: note.id }, includeResolved: true } });
  return { store, client, list, note, passage, act, threads };
}

test("the kit loads: three passage actions and an agent that answers in threads", async () => {
  const { list } = await setup();
  const kit = list.extensions.find(e => e.id === "marginalia")!;
  expect(kit.state).toBe("active");
  expect(kit.actions.map(a => [a.id, a.on])).toEqual([["highlight", "passage"], ["define", "passage"], ["cite", "passage"]]);
  expect(kit.agents).toEqual([expect.objectContaining({ name: "margin", threads: true })]);
});

test("highlight: an annotation with no body, its kind and colour as properties, written as the extension at the person's request", async () => {
  const { act, note, passage, threads, store } = await setup();
  const r = await act("highlight", passage(note, "before the glass warms"), { args: { color: "good" } });
  expect(r.written).toHaveLength(1);
  const [t] = await threads();
  expect(t!.body).toBe("");
  expect(t!.properties).toEqual({ kind: ["highlight"], color: ["good"] });
  expect(t!.block.text.split("\n")[0]).toBe("Highlight on “before the glass warms”");
  expect(t!.block.actorId).toBe("ext:marginalia");
  const anchor = t!.resolvedTarget!.anchor as { start: number; end: number; exact: string };
  expect(PLAN.slice(anchor.start, anchor.end)).toBe("before the glass warms");
  // Properties are open: the highlight is found by them like any block.
  expect(store.get(t!.block.id)!.properties).toContainEqual({ key: "kind", value: "highlight" });
});

test("define writes the glossary's meaning in the margin; a word it lacks writes nothing and says so", async () => {
  const { act, note, passage, threads } = await setup();
  const r = await act("define", passage(note, "soil pH"));
  expect(r.message).toMatch(/defined/);
  const [t] = await threads();
  expect(t!.body).toBe("how acid or sweet the soil is, from 0 to 14; 7 is neutral.");
  expect(t!.properties).toEqual({ kind: ["define"], tags: ["glossary"] });
  const none = await act("define", passage(note, "peppers"));
  expect(none.written).toEqual([]);
  expect(none.message).toMatch(/isn't in this note's glossary/);
});

test("cite hands back the quote and where it's from, at its line's fragment, and writes nothing", async () => {
  const { act, note, passage, threads } = await setup();
  const r = await act("cite", passage(note, "Water the tomatoes at dawn"));
  expect(r.copy).toBe(`> Water the tomatoes at dawn\n> — ((${note.id}^water))`);
  expect(r.written).toEqual([]);
  expect(await threads()).toEqual([]);
});

test("a passage read before the note moved on moves with its words; gone or twice, it's refused with the nearest match", async () => {
  const { act, note, passage, store, threads, client } = await setup();
  const read = passage(note, "soil pH near 6.5");
  const moved = store.update(note.id, `A line added on top.\n${note.text}`, note.revision, { author: "user" });
  const r = await act("highlight", read);
  expect(r.passage!.start).toBe(read.start + "A line added on top.\n".length);
  expect(r.passage!.revision).toBe(moved.revision);
  expect((await threads()).length).toBe(1);
  // The words gone: refused, nothing written, the nearest words named.
  const gone = store.update(note.id, moved.text.replace("near 6.5", "near 7"), moved.revision, { author: "user" });
  await expect(act("highlight", read)).rejects.toThrow(/select it again.*nearest: "soil pH near"/);
  // At its own revision a passage must be where it says.
  const fresh = passage(gone, "Keep the soil");
  await expect(act("highlight", { ...fresh, start: fresh.start + 1, end: fresh.end + 1 })).rejects.toThrow(/isn't at/);
  expect((await threads()).length).toBe(1);
  // A block action isn't handed a passage, and a passage action needs one.
  await expect(client.request({ action: "extensions.act", extension: "marginalia", extensionAction: "highlight", blockId: note.id })).rejects.toThrow(/acts on a passage/);
});

test("@margin in a person's comment on a passage is answered in its thread, from the note when no model is set up", async () => {
  const { client, note, threads } = await setup();
  const at = note.text.indexOf("cold frame");
  const receipt = await client.request<AnnotationBatchReceipt>({
    action: "annotations.batch", requestId: "ask-1", author: "user",
    operations: [{ operationId: "ask", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "@margin what hardens the seedlings?", source: "user", passage: { quote: "cold frame", start: at }, properties: { kind: "question" } } }],
  });
  const id = receipt.annotations[0]!.block.id;
  const thread = await until("the margin's answer", async () => (await threads()).find(t => t.block.id === id && t.replies.length));
  expect(thread.properties).toEqual({ kind: ["question"] });
  expect(thread.replies[0]!.block.actorId).toBe("ext:marginalia");
  expect(thread.replies[0]!.body).toMatch(/From the note itself/);
  expect(thread.replies[0]!.body).toMatch(/low glass box that hardens seedlings off/);
  // An agent's own @margin never sets one off (no loops).
  await client.request<AnnotationBatchReceipt>({
    action: "annotations.batch", requestId: "ask-2", author: "agent", provenance: { actorId: "loki-test" },
    operations: [{ operationId: "ask", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "@margin and the peppers?", source: "agent", passage: { quote: "peppers", start: note.text.indexOf("peppers") } } }],
  });
  await Bun.sleep(400);
  expect((await threads()).find(t => t.body.includes("and the peppers"))!.replies).toEqual([]);
});

test("a comment read at an older revision lands where its words are when it says what's around them", async () => {
  const { client, note, store, threads } = await setup();
  const at = note.text.indexOf("6.5");
  const now = store.update(note.id, `Moved down.\n${note.text}`, note.revision, { author: "user" });
  await client.request({
    action: "annotations.batch", requestId: "late", author: "user",
    operations: [{ operationId: "c", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "", source: "user",
      passage: { quote: "6.5", start: at, prefix: note.text.slice(at - 10, at), suffix: " for the" }, properties: { kind: "highlight", tags: ["soil", "peppers"] } } }],
  });
  const [t] = await threads();
  const anchor = t!.resolvedTarget!.anchor as { start: number };
  expect(now.text.slice(anchor.start, anchor.start + 3)).toBe("6.5");
  expect(t!.properties).toEqual({ kind: ["highlight"], tags: ["soil", "peppers"] });
  // Without context it's refused as stale, as before.
  await expect(client.request({
    action: "annotations.batch", requestId: "late-2", author: "user",
    operations: [{ operationId: "c", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "x", source: "user", passage: { quote: "6.5", start: at } } }],
  })).rejects.toThrow(/stale/);
});

test("annotation properties are checked: a raw colour or the store's own key is refused", async () => {
  const { client, note } = await setup();
  const op = (properties: Record<string, string>) => client.request({
    action: "annotations.batch", requestId: crypto.randomUUID(), author: "user",
    operations: [{ operationId: "c", type: "block-comment", input: { blockId: note.id, expectedRevision: note.revision, body: "", source: "user", passage: { quote: "6.5" }, properties } }],
  });
  await expect(op({ color: "#ffee00" })).rejects.toThrow(/theme tone/);
  await expect(op({ type: "x" })).rejects.toThrow(/store's own/);
});
