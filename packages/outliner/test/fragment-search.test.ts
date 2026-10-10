// PIE-424, PIE-295: fragment completion searches every note through the service, and anchors are written by
// it. Fictional notes only.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { searchFragmentCandidates, type FragmentCandidateCollection } from "../src/fragment-search";
import { ReferenceCompletionSession, referenceCompletionProvider } from "../src/reference-completion";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { TextBuffer } from "../src/text-buffer";
import type { Block } from "../src/types";

const note = (id: string, text: string, updatedAt = "2026-09-01T00:00:00Z"): Block =>
  ({ id, text, revision: 1, parentId: null, position: 0, author: "user", createdAt: updatedAt, updatedAt, properties: [] } as unknown as Block);

test("candidates: headings anchored or not (with the anchor they'd get), anchors by id, code left out, the draft first", () => {
  const garden = note("garden01", "Garden\n## Beds ^beds\n## Paths\n```\n## not a heading\n```\n- [ ] Stake the beans ^t-b3a515");
  const shed = note("shed0001", "Shed\n## Paths ^shed-paths", "2026-09-02T00:00:00Z");
  const r = searchFragmentCandidates([garden, shed], { noteQuery: "garden", fragmentQuery: "", mode: "heading" });
  // The note's anchors first (PIE-762), then what it doesn't have yet.
  expect(r.items.map(i => [i.label, i.fragmentId ?? null, i.anchor ?? null])).toEqual([
    ["Beds", "beds", null],
    ["[ ] Stake the beans", "t-b3a515", null],
    ["Paths", null, { fragmentId: "paths", line: "## Paths ^paths" }],
  ]);
  expect(searchFragmentCandidates([garden, shed], { fragmentQuery: "b3a", mode: "id" }).items.map(i => i.fragmentId)).toEqual(["t-b3a515"]);
  // Newest first without a note part; the draft's own text (as typed) comes first.
  expect(searchFragmentCandidates([garden, shed], { fragmentQuery: "paths" }).items.map(i => i.blockId)).toEqual(["shed0001", "garden01"]);
  const draft = { blockId: "garden01", text: "Garden\n## Harvest" };
  expect(searchFragmentCandidates([garden, shed], { fragmentQuery: "", draft }).items[0]).toMatchObject({ blockId: "garden01", label: "Harvest", anchor: { fragmentId: "harvest" } });
  expect(() => searchFragmentCandidates([garden], { limit: 0 })).toThrow("between 1 and");
});

test("passage mode (PIE-762): only the notes named, in their order; anchors first, then headings, paragraphs and list items with the anchor each would get", () => {
  const meeting = note("meet0001", [
    "Greenhouse meeting [type::meeting]",
    "",
    "We agreed to water the seedlings every morning. ^a10",
    "",
    "## Decision",
    "Buy a second water butt",
    "before the frost comes.",
    "",
    "- Ana brings the hose",
    "- [ ] Fix the vent ^vent",
    "```",
    "a line in code",
    "```",
  ].join("\n"));
  const other = note("other001", "Other\n\nA paragraph about frost. ^frost", "2026-09-05T00:00:00Z");
  const r = searchFragmentCandidates([other, meeting], { blockIds: ["meet0001"], fragmentQuery: "", mode: "passage" });
  expect(r.items.map(i => [i.kind, i.label, i.fragmentId ?? null, i.anchor?.fragmentId ?? null])).toEqual([
    ["paragraph", "We agreed to water the seedlings every morning.", "a10", null],
    ["list-item", "[ ] Fix the vent", "vent", null],
    ["heading", "Decision", null, "decision"],
    ["paragraph", "Buy a second water butt before the frost comes.", null, "buy-a-second"],
    ["list-item", "Ana brings the hose", null, "ana-brings-the"],
  ]);
  // The paragraph's anchor goes on its last line; the list item's on its own.
  expect(r.items[3]!.anchor!.line).toBe("before the frost comes. ^buy-a-second");
  expect(r.items[4]!.anchor!.line).toBe("- Ana brings the hose ^ana-brings-the");
  // Words narrow it; blockIds keeps the other note out even when it matches.
  expect(searchFragmentCandidates([other, meeting], { blockIds: ["meet0001"], fragmentQuery: "frost", mode: "passage" }).items.map(i => i.blockId)).toEqual(["meet0001"]);
  expect(searchFragmentCandidates([other, meeting], { blockIds: ["other001", "meet0001"], fragmentQuery: "frost", mode: "passage" }).items.map(i => i.blockId)).toEqual(["other001", "meet0001"]);
  expect(() => searchFragmentCandidates([meeting], { blockIds: "meet0001" as any })).toThrow("blockIds");
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

async function service() {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-fragment-search-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  return { store, client: new OutlinerClient(socket) };
}

test("fragments.candidates finds a fragment past the first 500 notes; fragments.ensure writes the anchor it offered, revision-checked", async () => {
  const { client } = await service();
  // 640 notes; the one with the wanted heading is written first, so it's the oldest.
  const target = await client.request<Block>({ action: "create", text: "Seed catalogue\n## Winter squash\nKeep the seed dry." });
  for (let i = 0; i < 640; i++) await client.request<Block>({ action: "create", text: `Filler note ${i}\n## Section ${i}\nSome prose.` });
  const found = await client.request<FragmentCandidateCollection>({ action: "fragments.candidates", query: { fragmentQuery: "winter squ", mode: "heading" } });
  expect(found.items).toEqual([expect.objectContaining({ blockId: target.id, label: "Winter squash", anchor: { fragmentId: "winter-squash", line: "## Winter squash ^winter-squash" } })]);
  const written = await client.request<{ fragmentId: string; created: boolean; block: Block }>({
    action: "fragments.ensure", blockId: target.id, lineIndex: 1, expectedRevision: target.revision, mutation: { author: "user", actorId: "fixture" },
  });
  expect(written).toMatchObject({ fragmentId: "winter-squash", created: true });
  expect(written.block.text).toBe("Seed catalogue\n## Winter squash ^winter-squash\nKeep the seed dry.");
  await expect(client.request({ action: "fragments.ensure", blockId: target.id, lineIndex: 1, expectedRevision: target.revision, mutation: { author: "user", actorId: "fixture" } }))
    .rejects.toThrow("changed since the fragment was offered");
}, 60_000);

test("fragments.ensure anchors a paragraph's last line and a list item, as passage mode offered them, attributed to who asked (PIE-762)", async () => {
  const { client } = await service();
  const target = await client.request<Block>({ action: "create", text: "Pond notes\n\nThe frogs came back\nin March.\n\n- Net the pond" });
  const found = await client.request<FragmentCandidateCollection>({ action: "fragments.candidates", query: { blockIds: [target.id], fragmentQuery: "", mode: "passage" } });
  expect(found.items.map(i => [i.label, i.lineIndex, i.anchor?.fragmentId])).toEqual([["The frogs came back in March.", 3, "the-frogs-came"], ["Net the pond", 5, "net-the-pond"]]);
  const written = await client.request<{ fragmentId: string; created: boolean; block: Block }>({
    action: "fragments.ensure", blockId: target.id, lineIndex: 3, expectedRevision: target.revision, mutation: { author: "agent", actorId: "pond-agent" },
  });
  expect(written).toMatchObject({ fragmentId: "the-frogs-came", created: true });
  expect(written.block.text).toBe("Pond notes\n\nThe frogs came back\nin March. ^the-frogs-came\n\n- Net the pond");
  const history = await client.request<{ revisions: { revision: number; author?: string; actorId?: string }[] }>({ action: "block.revisions", blockId: target.id });
  expect(history.revisions[0]).toMatchObject({ revision: written.block.revision, author: "agent", actorId: "pond-agent" });
  // A line inside a paragraph, a blank line or the title can't take one.
  for (const lineIndex of [0, 1, 2]) {
    await expect(client.request({ action: "fragments.ensure", blockId: target.id, lineIndex, expectedRevision: written.block.revision, mutation: { author: "user", actorId: "fixture" } }))
      .rejects.toThrow("can take an anchor");
  }
}, 30_000);

test("Detail's completion (the shared session) finds a heading in a 600+ note outline and adds its anchor through the service", async () => {
  const { client } = await service();
  const target = await client.request<Block>({ action: "create", text: "Orchard log\n## Pruning the plums" });
  for (let i = 0; i < 620; i++) await client.request<Block>({ action: "create", text: `Filler note ${i}\n## Heading ${i}` });
  const buffer = new TextBuffer("See ((Orchard#prun"); buffer.moveEnd();
  const session = new ReferenceCompletionSession(referenceCompletionProvider(client, "detail"), () => buffer, () => null, () => {}, () => true);
  await session.refresh();
  expect(session.state?.message ?? "").not.toContain("Searched only");
  expect(session.state?.items[0]).toMatchObject({ blockId: target.id, fragmentId: "pruning-the-plums", anchor: { lineIndex: 1 } });
  expect(await session.accept()).toBe(true);
  expect(buffer.text).toBe(`See ((${target.id}^pruning-the-plums))`);
  expect((await client.request<Block>({ action: "get", blockId: target.id })).text).toBe("Orchard log\n## Pruning the plums ^pruning-the-plums");
}, 60_000);
