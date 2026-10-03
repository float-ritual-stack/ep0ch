import {afterEach, expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {OutlinerClient} from "../src/client";
import {OutlinerServer} from "../src/server";
import {OutlinerStore} from "../src/store";
import type {WorkingSelection, WorkingSelectionRecovery, WorkingSelectionTarget} from "../src/types";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "outliner-working-selection-"));
  let store = new OutlinerStore(join(dir, "outline.sqlite"));
  let server = new OutlinerServer(store, join(dir, "outline.sock"));
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); rmSync(dir, {recursive: true, force: true}); });
  const client = new OutlinerClient(join(dir, "outline.sock"));
  const blocks = [store.create("Alpha"), store.create("Beta")];
  const targets = blocks.map(b => ({blockId: b.id, rowId: b.id}));
  const get = (ownerClientId: string) => client.request<WorkingSelection | null>({action: "working-selection.get", ownerClientId});
  const save = (ownerClientId: string, targets: WorkingSelectionTarget[], expected: WorkingSelection | null = null) =>
    client.request<WorkingSelection | null>({action: "working-selection.save", input: {ownerClientId, expected, targets}});
  const recoverable = (ownerClientId: string) => client.request<WorkingSelectionRecovery>({action: "working-selection.recoverable", ownerClientId});
  const resume = (ownerClientId: string, previous: WorkingSelection) => client.request<WorkingSelection>({
    action: "working-selection.resume", ownerClientId, selectionId: previous.id, expectedRevision: previous.revision,
  });
  const restart = async () => {
    await server.close(); store.close();
    store = new OutlinerStore(join(dir, "outline.sqlite"));
    server = new OutlinerServer(store, join(dir, "outline.sock"));
    await server.start();
  };
  return {client, get, save, recoverable, resume, restart, targets, blocks, store: () => store};
}

test("working selection survives restart and unavailable targets without changing canonical focus; clear is durable", async () => {
  const f = await fixture();
  const focus = f.store().getSelection();
  const sequence = f.store().sequence;
  const targets = [f.targets[1]!, {...f.targets[0]!, viewId: "view-a", parentRowId: "appearance-a"}];
  const original = (await f.save("old-tree", targets))!;
  expect(original.targets).toEqual(targets);
  expect(f.store().sequence).toBe(sequence);
  expect(f.store().getSelection()).toEqual(focus);
  f.store().delete(f.blocks[0]!.id);
  await f.restart();
  expect(await f.get("new-tree")).toBeNull();
  const recovery = await f.recoverable("new-tree");
  expect(recovery.completeness.kind).toBe("complete");
  expect(recovery.selections).toEqual([original]);
  const resumed = await f.resume("new-tree", original);
  expect(resumed.targets).toEqual(targets); // Deleted targets remain accounted for.
  expect(resumed.revision).toBe(original.revision + 1);
  expect(await f.get("old-tree")).toBeNull();
  expect(await f.get("new-tree")).toEqual(resumed);
  expect(await f.save("new-tree", [], resumed)).toBeNull();
  await f.restart();
  expect(await f.get("new-tree")).toBeNull();
  expect((await f.recoverable("third-tree")).selections).toEqual([]);
  await expect(f.save("new-tree", targets, resumed)).rejects.toThrow(/changed|missing/i);
});

test("selection ownership and revisions prevent a second pane or stale response from replacing a set", async () => {
  const f = await fixture();
  const connected = Promise.withResolvers<void>();
  const watcher = f.client.watch({client: {clientId: "live-tree", contextId: "live-context", role: "tree"}, onConnect: connected.resolve, onEvent() {}});
  try {
    await connected.promise;
    const original = (await f.save("live-tree", f.targets))!;
    expect((await f.recoverable("other-tree")).selections).toEqual([]);
    await expect(f.resume("other-tree", original)).rejects.toThrow(/live|connected/i);
    await expect(f.save("other-tree", [], original)).rejects.toThrow(/owner/i);
    await expect(f.save("live-tree", f.targets)).rejects.toThrow(/changed|exists/i);
    const edited = (await f.save("live-tree", [f.targets[1]!], original))!;
    await expect(f.save("live-tree", [], original)).rejects.toThrow(/changed/i);
    await expect(f.save("live-tree", [f.targets[0]!, f.targets[0]!], edited)).rejects.toThrow(/duplicate/i);
    await expect(f.save("live-tree", Array(1001).fill(f.targets[0]), edited)).rejects.toThrow(/1000|limit/i);
    expect(await f.get("live-tree")).toEqual(edited);
    await watcher.stop();
    // Observe service-side disconnect, not just the local socket closing.
    for (let i = 0; i < 100 && !(await f.recoverable("other-tree")).selections.length; i++) await Bun.sleep(5);
    expect((await f.recoverable("other-tree")).selections).toEqual([edited]);
    const other = (await f.save("other-tree", [f.targets[0]!]))!;
    await expect(f.resume("other-tree", edited)).rejects.toThrow(/clear|already/i);
    await f.save("other-tree", [], other);
    await expect(f.resume("other-tree", original)).rejects.toThrow(/changed/i);
    const recovered = await f.resume("other-tree", edited);
    await expect(f.resume("third-tree", edited)).rejects.toThrow(/changed/i);
    expect(await f.get("other-tree")).toEqual(recovered);
  } finally { await watcher.stop(); }
});
