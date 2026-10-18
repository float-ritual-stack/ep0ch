// Yolo reaches the service (PIE-973): while a door says so, an agent passes the service's own rules as the person
// would, and the moment the door says otherwise (or goes) it is refused again. Fictional notes only.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpAccessStatus } from "@ep0ch/outline-core/protocol";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import { OutlinerClient } from "../src/client";
import type { DraftPatchResult } from "../src/draft-patch";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { OutlinerEvent } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function service() {
  const directory = mkdtempSync(join(tmpdir(), "pi-outliner-yolo-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const store = new OutlinerStore(join(directory, "outliner.sqlite"));
  const server = new OutlinerServer(store, join(directory, "outliner.sock"));
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); });
  const client = new OutlinerClient(join(directory, "outliner.sock"), 10_000);
  /** A door: a connected client, with the events it heard. */
  const door = async (clientId: string) => {
    const heard: OutlinerEvent[] = [];
    const connected = Promise.withResolvers<void>();
    const watcher = client.watch({ client: { clientId, role: "observer", contextId: clientId }, onConnect: connected.resolve, onEvent: (event: OutlinerEvent) => { heard.push(event); } });
    cleanups.push(() => watcher.stop());
    await connected.promise;
    return { clientId, heard, leave: () => watcher.stop() };
  };
  /** What agents did to a block, from the activity record (author, actor id, task id). */
  const activity = async (blockId: string) => (await client.request<{ entries: Array<{ block: { id: string }; actorId?: string; taskId?: string }> }>({
    action: "activity.recent", since: "2000-01-01T00:00:00.000Z", author: "agent", limit: 100, kinds: ["text", "properties", "move", "delete", "restore"],
  })).entries.filter(entry => entry.block.id === blockId);
  return { store, client, door, activity, socket: join(directory, "outliner.sock") };
}

const spanOf = (text: string, observed: string, replacement: string): DraftPatchSpan => {
  const start = text.indexOf(observed);
  return { observed, replacement, range: { start, end: start + observed.length }, unit: "utf16" };
};
const TIDY = { author: "agent" as const, actorId: "tidy" };
const OTHER = { author: "agent" as const, actorId: "other-agent" };
const status = (client: OutlinerClient) => client.request<McpAccessStatus>({ action: "mcp.access.status" });
/** Waits for something the service sends after the request answered (a disconnect is noticed a moment later). */
const eventually = async (check: () => Promise<boolean>) => { for (let i = 0; i < 50 && !(await check()); i += 1) await Bun.sleep(20); };

describe("yolo in the service", () => {
  test("revisions keep a yolo writer after another save, and the CLI names whose permission it used", async () => {
    const { store, client, door, socket } = await service();
    const note = store.create("Seed ledger");
    const mine = await door("history-door");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    await client.request({ action: "update", blockId: note.id, text: "Seed ledger\nBeans", expectedRevision: 1, mutation: { author: "agent", actorId: "cowboy", taskId: "seed-order" } });
    const revisions = () => client.request<import("@ep0ch/outline-core/protocol").BlockRevisions>({ action: "block.revisions", blockId: note.id });
    expect((await revisions()).revisions[0]).toMatchObject({ author: "agent", actorId: "cowboy", taskId: "seed-order+via:yolo" });
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: false });
    await client.request({ action: "update", blockId: note.id, text: "Seed ledger\nBeans and peas", expectedRevision: 2, mutation: { author: "user" } });
    expect((await revisions()).revisions[1]).toMatchObject({ author: "agent", actorId: "cowboy", taskId: "seed-order+via:yolo" });
    const process = Bun.spawn(["bun", "packages/door/src/main.ts", "revisions", note.id], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...Bun.env, EP0CH_SOCKET: socket, EP0CH_WS: "scratch" }, stdout: "pipe", stderr: "pipe",
    });
    const output = await new Response(process.stdout).text();
    expect(await process.exited).toBe(0);
    expect(output).toContain("by cowboy · for evan · via yolo");
  });

  test("only a connected door turns it on; an agent can't", async () => {
    const { client, door } = await service();
    await expect(client.request({ action: "agents.yolo", clientId: "ghost", on: true })).rejects.toThrow("subscribe with that clientId first");
    const mine = await door("door-a");
    await expect(client.request({ action: "agents.yolo", clientId: mine.clientId, on: true, mutation: OTHER })).rejects.toThrow("yolo is the person's to hand over");
    expect((await status(client)).yolo).toBeUndefined();
    expect(await client.request<{ yolo: boolean }>({ action: "agents.yolo", clientId: mine.clientId, on: true })).toEqual({ yolo: true });
  });

  test("an agent dismisses another agent's proposal with or without yolo; while it is on, the record says so", async () => {
    const { store, client, door, activity } = await service();
    const dismiss = (proposalId: string) => client.request({ action: "draft.proposal.dismiss", proposalId, mutation: OTHER });
    const propose = async (text: string) => {
      const note = store.create(`Plan\n${text}\n@tidy go`);
      const result = await client.request<DraftPatchResult>({ action: "draft.patch", blockId: note.id, revision: note.revision, patches: [spanOf(note.text, text, "beans here")], propose: "always", mutation: TIDY });
      if (result.outcome !== "proposed") throw new Error("expected a proposal");
      return result.proposalId;
    };
    // No yolo: the agent nearest the work settles another agent's proposal (Evan, Oct 17), recorded as itself.
    const first = await propose("beans   here");
    expect(await dismiss(first)).toMatchObject({ outcome: "dismissed" });
    expect(await activity(first)).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: "other-agent" })]));
    expect(await activity(first)).not.toEqual(expect.arrayContaining([expect.objectContaining({ taskId: "via:yolo" })]));

    // Yolo on: the same dismiss, and the record says whose permission it used.
    const mine = await door("door-a");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    const second = await propose("beans    there");
    expect(await dismiss(second)).toMatchObject({ outcome: "dismissed" });
    expect(await activity(second)).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: "other-agent", taskId: "via:yolo" })]));

    // The door goes: yolo goes with it, with no word from the door.
    mine.leave();
    await eventually(async () => (await status(client)).yolo === undefined);
    expect((await status(client)).yolo).toBeUndefined();
  });

  test("a propose-level outline acts as full (and says so, with the owner's setting beside it); read-only too", async () => {
    const { client, door } = await service();
    await client.request({ action: "mcp.access.configure", level: "propose" });
    const mine = await door("door-a");
    expect(await status(client)).toMatchObject({ level: "propose", canRead: true });
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    expect(await status(client)).toMatchObject({ level: "full", canRead: true, yolo: true, configured: "propose" });
    // Another door hears it, and a door that joins reads it.
    const other = await door("door-b");
    await client.request({ action: "agents.yolo", clientId: other.clientId, on: false });
    await eventually(async () => mine.heard.some(e => e.domain === "agents" && e.yolo === false));
    expect(mine.heard.filter(e => e.domain === "agents").map(e => e.yolo)).toEqual([true, false]);
    // Read-only and none lift the same.
    await client.request({ action: "mcp.access.configure", level: "none" });
    expect((await status(client)).level).toBe("none");
    await client.request({ action: "agents.yolo", clientId: other.clientId, on: true });
    expect(await status(client)).toMatchObject({ level: "full", canRead: true, configured: "none" });
  });

  test("an agent applies a proposal that only the person may apply (a prose edit that drops structure), still as the agent", async () => {
    const { store, client, door, activity } = await service();
    const note = store.create("Beds [season::spring]\nThe fence bed holds the beans.");
    const proposed = await client.request<DraftPatchResult>({ action: "draft.patch", blockId: note.id, revision: note.revision, patches: [spanOf(note.text, "Beds [season::spring]", "Beds")], policy: "prose", mutation: TIDY });
    if (proposed.outcome !== "proposed") throw new Error("expected a proposal");
    const apply = () => client.request({ action: "draft.proposal.apply", proposalId: proposed.proposalId, mutation: OTHER });
    await expect(apply()).rejects.toThrow("only the person applies that anyway");
    const mine = await door("door-a");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    expect(await apply()).toMatchObject({ outcome: "applied" });
    expect(store.require(note.id).text).toBe("Beds\nThe fence bed holds the beans.");
    expect(await activity(note.id)).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: "other-agent", taskId: "via:yolo" })]));
  });

  test("the guard on dropped structure lets an agent's patch through, still written as the agent's", async () => {
    const { store, client, door, activity } = await service();
    const page = store.create("Beds [page::beds]\nThe fence bed holds the beans. ^fence");
    store.create(`Plan\nsee ((${page.id}^fence))`);
    const patches = [spanOf(page.text, "beans. ^fence", "beans.")];
    await expect(client.request({ action: "draft.patch", blockId: page.id, revision: page.revision, patches, mutation: TIDY })).rejects.toThrow("would drop ^fence");
    const mine = await door("door-a");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    await client.request({ action: "draft.patch", blockId: page.id, revision: page.revision, patches, mutation: TIDY });
    expect(store.require(page.id).text).toBe("Beds [page::beds]\nThe fence bed holds the beans.");
    expect(await activity(page.id)).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: "tidy", taskId: "via:yolo" })]));
  });
});
