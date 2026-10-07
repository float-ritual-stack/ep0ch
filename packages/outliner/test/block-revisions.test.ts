// PIE-621: a block's earlier texts, kept when a save replaces them, so a saved note can go back (block.revisions).
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore, REVISIONS_KEEP } from "../src/store";
import type { Block, BlockRevisionEntry, BlockRevisions } from "../src/types";

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const root = () => { const r = realpathSync(mkdtempSync(join(tmpdir(), "outliner-revisions-"))); roots.push(r); return r; };

test("every save keeps the text it replaced: listed newest first after the current one, each one's text read back", () => {
  const store = new OutlinerStore(join(root(), "outliner.sqlite"));
  const b = store.create("Seed order\n- beans");
  const r2 = store.update(b.id, "Seed order\n- beans\n- peas", b.revision, { author: "user" });
  // A whole document pasted by mistake, then saved.
  const pasted = `Seed order\n- beans\n- peas\n${Array.from({ length: 40 }, (_, i) => `pantry line ${i}`).join("\n")}`;
  const r3 = store.update(b.id, pasted, r2.revision, { author: "agent", actorId: "tidy" });
  const list = store.revisions(b.id);
  expect(list.revision).toBe(r3.revision);
  expect(list.revisions.map(r => r.revision)).toEqual([3, 2, 1]);
  expect(list.revisions[0]).toMatchObject({ revision: 3, author: "agent", actorId: "tidy", lines: 43, firstLine: "Seed order" });
  expect(list.revisions[1]).toMatchObject({ revision: 2, author: "user", lines: 3 });
  expect(store.revisionText(b.id, 2).text).toBe("Seed order\n- beans\n- peas");
  expect(store.revisionText(b.id, 3).text).toBe(pasted);
  // Going back is an ordinary save of that text, itself a revision (so it can be gone back on too).
  const back = store.update(b.id, store.revisionText(b.id, 2).text, r3.revision, { author: "user" });
  expect(back.text).toBe("Seed order\n- beans\n- peas");
  expect(store.revisionText(b.id, 3).text).toBe(pasted);
  expect(() => store.revisionText(b.id, 9)).toThrow("Revision 9 of");
  // A move changes the block's updatedAt, never when its text was saved.
  const saved = store.revisions(b.id).revisions[0]!.savedAt;
  const shelf = store.create("Shelf");
  Bun.sleepSync(5);
  store.move(b.id, shelf.id);
  expect(store.revisions(b.id).revisions[0]!.savedAt).toBe(saved);
  store.close();
});

test(`the newest ${REVISIONS_KEEP} texts are kept, counted by text kept, not by revision number`, () => {
  const store = new OutlinerStore(join(root(), "outliner.sqlite"));
  let b = store.create("text 0");
  // Saves of the same text move the revision on and keep nothing: they mustn't push real history out.
  for (let i = 1; i <= REVISIONS_KEEP; i++) {
    b = store.update(b.id, `text ${i}`, b.revision);
    if (i % 2) b = store.update(b.id, `text ${i}`, b.revision);
  }
  const kept = store.revisions(b.id).revisions.slice(1);
  expect(b.revision).toBeGreaterThan(REVISIONS_KEEP + 40);
  expect(kept.length).toBe(REVISIONS_KEEP);
  expect(store.revisionText(b.id, kept.at(-1)!.revision).text).toBe("text 0");
  // One more change: the oldest text goes, and only it.
  b = store.update(b.id, "text last", b.revision);
  const after = store.revisions(b.id).revisions.slice(1);
  expect(after.length).toBe(REVISIONS_KEEP);
  expect(store.revisionText(b.id, after.at(-1)!.revision).text).toBe("text 1");
  store.close();
});

test(`the newest ${REVISIONS_KEEP} are kept`, () => {
  const store = new OutlinerStore(join(root(), "outliner.sqlite"));
  let b = store.create("count 0");
  for (let i = 1; i <= REVISIONS_KEEP + 5; i++) b = store.update(b.id, `count ${i}`, b.revision);
  const list = store.revisions(b.id).revisions;
  expect(list.length).toBe(REVISIONS_KEEP + 1);
  expect(list.at(-1)!.revision).toBe(b.revision - REVISIONS_KEEP);
  store.close();
});

test("through the service: block.revisions lists them, and with revision= answers that one's text", async () => {
  const dir = root();
  const store = new OutlinerStore(join(dir, "outliner.sqlite"));
  const server = new OutlinerServer(store, join(dir, "o.sock"), undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  const client = new OutlinerClient(join(dir, "o.sock"));
  try {
    const b = await client.request<Block>({ action: "create", text: "Rota\nwhoever cooks doesn't wash up" });
    await client.request<Block>({ action: "update", blockId: b.id, text: "Rota\nwhoever cooks washes up", expectedRevision: b.revision, mutation: { author: "user" } });
    const list = await client.request<BlockRevisions>({ action: "block.revisions", blockId: b.id });
    expect(list.revisions.map(r => r.revision)).toEqual([2, 1]);
    const one = await client.request<BlockRevisionEntry & { text: string }>({ action: "block.revisions", blockId: b.id, revision: 1 });
    expect(one.text).toBe("Rota\nwhoever cooks doesn't wash up");
  } finally {
    await server.close();
    store.close();
  }
});
