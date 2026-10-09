// PIE-693: `blocks.facets`, each block's kind, stage and dates as an Outlink's target carries them, for the rows the
// door's links model lists that aren't links (a note's children). Fictional notes, a temp store.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { LinkTargetFacets } from "../src/types";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

test("blocks.facets: kind and stage by the backlinks' rules; missing and trashed ids said; bad input refused", async () => {
  const directory = mkdtempSync(join(tmpdir(), "outliner-block-facets-"));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const socket = join(directory, "outliner.sock");
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });

  const plan = store.create("Shed plan [type::project]");
  const item = store.create("Ask about the roof felt [type::outbox-item] [status::waiting]", plan.id);
  const plain = store.create("Measure the door", plan.id);
  const done = store.create("Buy hinges [type::errand] [work-stage::done]", plan.id);
  const gone = store.create("Old sketch", plan.id);
  store.delete(gone.id);

  const client = new OutlinerClient(socket);
  const read = await client.request<{ facets: Record<string, LinkTargetFacets>; missing: string[] }>({ action: "blocks.facets", blockIds: [item.id, plain.id, done.id, gone.id, "nope"] });
  expect(read.facets[item.id]).toMatchObject({ kind: "outbox-item", kindLabel: "Outbox item", stage: { bucket: "waiting" } });
  // An untyped child takes its containing note's kind, as a backlink source does.
  expect(read.facets[plain.id]).toMatchObject({ kind: "project", kindLabel: "Project" });
  expect(read.facets[plain.id]!.stage).toBeUndefined();
  expect(read.facets[done.id]).toMatchObject({ kind: "errand", stage: { bucket: "done" } });
  expect(typeof read.facets[item.id]!.updatedAt).toBe("string");
  expect(read.missing.sort()).toEqual([gone.id, "nope"].sort());

  await expect(client.request({ action: "blocks.facets", blockIds: "x" as unknown as string[] })).rejects.toThrow(/array of block ids/);
  await expect(client.request({ action: "blocks.facets", blockIds: Array.from({ length: 1001 }, (_, i) => `b${i}`) })).rejects.toThrow(/at most 1000/);
});
