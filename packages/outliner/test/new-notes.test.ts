// New notes from anywhere (PIE-544): one placement rule (src/note-placement.ts), the page stub through it, and a
// page naming its own title on every client write (outline-core's page-title.ts). Fictional notes.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block, NewNoteReceipt, PageAddressFollowResult } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function startService() {
  const directory = mkdtempSync(join(tmpdir(), "outliner-new-notes-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const inbox = store.readWorkspaceSnapshot().physical.blocks.find(b => b.properties.some(p => p.key === "system-view" && p.value === "inbox"))!;
  return { client: new OutlinerClient(socket), store, inbox };
}

test("notes.create puts a note at the top of the Inbox by default, and says so", async () => {
  const { client, inbox } = await startService();
  await client.request<NewNoteReceipt>({ action: "notes.create", text: "Older capture" });
  const r = await client.request<NewNoteReceipt>({ action: "notes.create", text: "Seed order for the plot" });
  expect(r.placement).toEqual({ parentId: inbox.id, at: "top", rule: "inbox", said: "in the Inbox" });
  expect(r.block).toMatchObject({ parentId: inbox.id, position: 0, author: "user", text: "Seed order for the plot" });
});

test("a note made from inside another goes under it, last; a gone or system note falls back to the Inbox", async () => {
  const { client, store, inbox } = await startService();
  const plot = await client.request<Block>({ action: "create", text: "Plot notes" });
  await client.request<Block>({ action: "create", text: "Beds", parentId: plot.id });
  const r = await client.request<NewNoteReceipt>({ action: "notes.create", text: "", intent: { kind: "note", near: plot.id }, author: "agent", provenance: { actorId: "gardener" } });
  expect(r.placement).toMatchObject({ parentId: plot.id, at: "end", rule: "near", said: "under “Plot notes”" });
  expect(r.block).toMatchObject({ parentId: plot.id, position: 1, text: "", author: "agent", actorId: "gardener" });

  store.delete(plot.id);
  expect((await client.request<NewNoteReceipt>({ action: "notes.create", intent: { kind: "note", near: plot.id } })).placement.rule).toBe("inbox");
  expect((await client.request<NewNoteReceipt>({ action: "notes.create", intent: { kind: "note", near: inbox.id } })).placement).toMatchObject({ parentId: inbox.id, at: "top" });
  await expect(client.request({ action: "notes.create", intent: { kind: "page" } as unknown as { kind: "note" } })).rejects.toThrow("pages.follow");
});

test("a near the caller named (nearOnly) that doesn't resolve is refused, nothing made; without it the Inbox takes the note", async () => {
  const { client, store, inbox } = await startService();
  const plot = await client.request<Block>({ action: "create", text: "Plot notes" });
  store.delete(plot.id);
  const before = store.readWorkspaceSnapshot().physical.blocks.length;
  await expect(client.request({ action: "notes.create", text: "Beans up", intent: { kind: "note", near: plot.id, nearOnly: true } })).rejects.toThrow(`No live note ${plot.id} to put the new note under`);
  await expect(client.request({ action: "notes.create", text: "Beans up", intent: { kind: "note", near: inbox.id, nearOnly: true } })).rejects.toThrow("No live note");
  expect(store.readWorkspaceSnapshot().physical.blocks.length).toBe(before);
  expect((await client.request<NewNoteReceipt>({ action: "notes.create", text: "Beans up", intent: { kind: "note", near: plot.id } })).placement.rule).toBe("inbox");
});

test("quick capture places through the same rule: the top of the Inbox", async () => {
  const { client, inbox } = await startService();
  await client.request({ action: "capture.create", requestId: "capture-one", text: "Older capture", source: "cli" });
  const r = await client.request<{ block: Block; inboxBlockId: string }>({ action: "capture.create", requestId: "capture-two", text: "Seed swap Saturday", source: "cli" });
  expect(r.inboxBlockId).toBe(inbox.id);
  expect(r.block).toMatchObject({ parentId: inbox.id, position: 0 });
});

test("a missing [[page]] followed is made where new notes go: the top of the Inbox", async () => {
  const { client, inbox } = await startService();
  const r = await client.request<PageAddressFollowResult>({ action: "pages.follow", address: "Evans Thotts" });
  expect(r.created).toBe(true);
  expect(r.block).toMatchObject({ parentId: inbox.id, position: 0, text: "Evans Thotts [page::Evans Thotts]" });
  expect(r.placement).toMatchObject({ rule: "inbox", said: "in the Inbox" });
  // The link resolves from then on, however it's cased.
  expect((await client.request<PageAddressFollowResult>({ action: "pages.resolve", address: "evans thotts" })).block?.id).toBe(r.block!.id);
});

test("[page::x] fills its own title on create, update and notes.create; a title already there is never overwritten", async () => {
  const { client } = await startService();
  const made = await client.request<NewNoteReceipt>({ action: "notes.create", text: "[page::2026-09-30]\nWatered the leeks." });
  expect(made.block.text).toBe("2026-09-30 [page::2026-09-30]\nWatered the leeks.");
  const created = await client.request<Block>({ action: "create", text: "[page::seed-library]" });
  expect(created.text).toBe("seed-library [page::seed-library]");
  const blank = await client.request<Block>({ action: "create", text: "Draft" });
  const updated = await client.request<Block>({ action: "update", blockId: blank.id, text: "[page::2026-10-01]", expectedRevision: blank.revision, mutation: { author: "user" } });
  expect(updated.text).toBe("2026-10-01 [page::2026-10-01]");
  const kept = await client.request<Block>({ action: "update", blockId: updated.id, text: "Plot day [page::2026-10-01]", expectedRevision: updated.revision, mutation: { author: "user" } });
  expect(kept.text).toBe("Plot day [page::2026-10-01]");
});

test("a recovered edit's text is titled too: edit-recovery.commit applies the page-title rule", async () => {
  const { client } = await startService();
  const base = await client.request<Block>({ action: "create", text: "Draft" });
  const record = await client.request<{ id: string; revision: number }>({ action: "edit-recovery.start", input: { id: crypto.randomUUID(), blockId: base.id, baseText: base.text, baseRevision: base.revision, prelaunchText: base.text, draftText: "[page::2026-10-04]", source: "external-editor" } });
  const saved = await client.request<Block>({ action: "edit-recovery.commit", recoveryId: record.id, expectedRevision: record.revision, text: "[page::2026-10-04]", basedOnRevision: base.revision, mutation: { author: "user" } });
  expect(saved.text).toBe("2026-10-04 [page::2026-10-04]");
});
