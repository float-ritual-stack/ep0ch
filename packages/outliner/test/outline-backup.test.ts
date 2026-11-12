// PIE-1750: only the host opens a live outline file. A backup is the host's `outlines.backup` (a copy made on the store's
// own connection, between its writes); an outline's change and schema come from `outlines.list`; a stopped outline is
// read by the host's own look, never opened for it. Scratch outlines with fictional notes only.
import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlinerClient } from "../src/client";
import { checkCopy } from "../src/outline-file";
import { OutlineHost } from "../src/outline-host";
import { SCHEMA_VERSION } from "../src/schema";
import { OutlinerStore } from "../src/store";
import type { HostedOutlineBackup, HostedOutlineList } from "../src/types";
import { scratchDir } from "./scratch-outline";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function scratchHost() {
  const root = scratchDir("outline-backup-");
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const layout = outlineLayout(join(root, "outlines"));
  const host = new OutlineHost({ outlinesFolder: layout.root, log: () => {} });
  await host.start();
  cleanups.push(() => host.close());
  const client = new OutlinerClient(layout.socket, 30_000);
  return { root, layout, host, client };
}

/** What a copy holds, read from the copy (a copy is never a live outline). */
function inCopy(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    return {
      changeSeq: (db.query("SELECT max(change_id) AS n FROM change_feed").get() as { n: number }).n,
      schema: (db.query("PRAGMA user_version").get() as { user_version: number }).user_version,
      texts: (db.query("SELECT text FROM blocks").all() as { text: string }[]).map(r => r.text),
    };
  } finally { db.close(); }
}

test("a backup through the host is a consistent copy while writes go on, and no write is refused", async () => {
  const { root, layout, host, client } = await scratchHost();
  await host.create("garden");
  const garden = new OutlinerClient(layout.socket, 30_000, "garden");
  const made: HostedOutlineBackup[] = [];
  // Four rounds: writes sent, and a backup asked while they land.
  for (let round = 0; round < 4; round++) {
    const writes = Array.from({ length: 15 }, (_, i) => garden.request({ action: "create", text: `Sow row ${round * 15 + i}`, parentId: null }));
    const backup = client.request<HostedOutlineBackup>({ action: "outlines.backup", name: "garden", out: join(root, `garden-${round}.sqlite`) });
    await Promise.all(writes);
    made.push(await backup);
  }
  for (const b of made) {
    expect(checkCopy(b.path)).toBe("ok");
    const copy = inCopy(b.path);
    // The answer describes the copy it made: the same change, the same schema.
    expect(copy.changeSeq).toBe(b.changeSeq);
    expect(copy.schema).toBe(SCHEMA_VERSION);
    expect(b.schema).toBe(SCHEMA_VERSION);
    // Every row it holds is whole: a copy between writes, never half of one.
    const rows = copy.texts.filter(t => t.startsWith("Sow row ")).map(t => Number(t.slice(8)));
    expect(rows).toEqual([...rows].sort((a, z) => a - z));
    expect(rows).toEqual(Array.from({ length: rows.length }, (_, i) => i));
  }
  // Each round's copy holds every write of the rounds before it: the writes went on between them.
  for (let round = 1; round < made.length; round++) {
    expect(made[round]!.changeSeq).toBeGreaterThan(made[round - 1]!.changeSeq);
    expect(inCopy(made[round]!.path).texts.filter(t => t.startsWith("Sow row ")).length).toBeGreaterThanOrEqual(round * 15);
  }
  // A backup writes nothing to the outline: the change it reports is still the newest after it.
  const after = await client.request<HostedOutlineBackup>({ action: "outlines.backup", name: "garden", out: join(root, "garden-last.sqlite") });
  const list = await client.request<HostedOutlineList>({ action: "outlines.list" });
  expect(list.outlines.find(o => o.name === "garden")).toMatchObject({ open: true, changeSeq: after.changeSeq, schema: SCHEMA_VERSION });
});

test("a stopped outline is backed up and described by the host's own look, and stays stopped", async () => {
  const root = scratchDir("outline-backup-");
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const layout = outlineLayout(join(root, "outlines"));
  // Written once, then left: nothing serves it when the host starts.
  const store = new OutlinerStore(layout.database("pantry"), { workspaceRoot: layout.folder("pantry") });
  store.create("Flour, two bags");
  const before = store.fileFacts();
  store.close();
  const host = new OutlineHost({ outlinesFolder: layout.root, log: () => {} });
  await host.start();
  cleanups.push(() => host.close());
  const client = new OutlinerClient(layout.socket, 30_000);
  const listed = (await client.request<HostedOutlineList>({ action: "outlines.list" })).outlines.find(o => o.name === "pantry");
  expect(listed).toMatchObject({ open: false, changeSeq: before.changeSeq, schema: SCHEMA_VERSION });
  const out = join(root, "pantry-copy.sqlite");
  const b = await client.request<HostedOutlineBackup>({ action: "outlines.backup", name: "pantry", out });
  expect(b).toMatchObject({ name: "pantry", path: out, changeSeq: before.changeSeq, schema: SCHEMA_VERSION });
  expect(checkCopy(out)).toBe("ok");
  expect(inCopy(out).texts).toContain("Flour, two bags");
  expect((await client.request<HostedOutlineList>({ action: "outlines.list" })).outlines.find(o => o.name === "pantry")?.open).toBe(false);
});

test("a backup is never written over a file, nor to a relative path, nor of an outline that isn't here", async () => {
  const { root, host, client } = await scratchHost();
  await host.create("orchard");
  const taken = join(root, "taken.sqlite");
  writeFileSync(taken, "kept");
  await expect(client.request({ action: "outlines.backup", name: "orchard", out: taken })).rejects.toThrow(/already exists; not overwritten/);
  expect(await Bun.file(taken).text()).toBe("kept");
  await expect(client.request({ action: "outlines.backup", name: "orchard", out: "orchard.sqlite" })).rejects.toThrow(/absolute path/);
  await expect(client.request({ action: "outlines.backup", name: "meadow", out: join(root, "meadow.sqlite") })).rejects.toThrow(/No outline named "meadow"/);
  expect(existsSync(join(root, "meadow.sqlite"))).toBe(false);
});
