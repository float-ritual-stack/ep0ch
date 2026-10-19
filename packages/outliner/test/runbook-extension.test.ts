import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";

test("designating an existing runbook saves distinct durable fence anchors before running, including copied child steps", async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "runbook-identity-"));
  const folder = join(scratchRoot, "outline");
  mkdirSync(join(folder, "extensions"), { recursive: true });
  const db = join(scratchRoot, "runbook.sqlite");
  const store = new OutlinerStore(db, { workspaceRoot: folder });
  const server = new OutlinerServer(store, join(scratchRoot, "host.sock"), undefined, undefined, { extensionPollMs: 0, stateDirectory: join(scratchRoot, "state") });
  await server.start();
  const client = new OutlinerClient(join(scratchRoot, "host.sock"));
  const create = (text: string, parentId: string | null = null) => client.request<Block>({ action: "create", text, parentId, author: "user" });
  let child!: Block, root!: Block;
  try {
    root = await create("Garden maintenance");
    child = await create("Water the pots\nrun::\n```sh\nprintf water\n```", root.id);
    await client.request({ action: "update", mutation: { author: "user" }, blockId: root.id, text: `${root.text} [type::runbook]`, expectedRevision: root.revision });
    child = await client.request<Block>({ action: "get", blockId: child.id });
    expect(child.text).toContain("^step-water-the-pots");
    const copied = await create(child.text, root.id);
    expect(copied.text).toContain("^step-water-the-pots-2");
    const changed = await client.request<Block>({ action: "update", mutation: { author: "user" }, blockId: child.id, expectedRevision: child.revision, text: child.text.replace("Water the pots", "Water the seedlings").replace("printf water", "printf seedlings") });
    expect(changed.text).toContain("^step-water-the-pots");
    expect(await client.request<Block[]>({ action: "children", parentId: child.id })).toHaveLength(0);
  } finally { await server.close(); store.close(); }
  const reopened = new OutlinerStore(db, { workspaceRoot: folder });
  try {
    expect(reopened.require(child.id).text).toContain("^step-water-the-pots");
    expect(reopened.children(root.id).some(b => b.text.includes("[type::run]"))).toBe(false);
  } finally { reopened.close(); rmSync(scratchRoot, { recursive: true, force: true }); }
});
