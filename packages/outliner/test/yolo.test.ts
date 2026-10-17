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
  return { store, client, door };
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
  test("only a connected door turns it on; an agent can't", async () => {
    const { client, door } = await service();
    await expect(client.request({ action: "agents.yolo", clientId: "ghost", on: true })).rejects.toThrow("subscribe with that clientId first");
    const mine = await door("door-a");
    await expect(client.request({ action: "agents.yolo", clientId: mine.clientId, on: true, mutation: OTHER })).rejects.toThrow("yolo is the person's to hand over");
    expect((await status(client)).yolo).toBeUndefined();
    expect(await client.request<{ yolo: boolean }>({ action: "agents.yolo", clientId: mine.clientId, on: true })).toEqual({ yolo: true });
  });

  test("an agent dismisses another agent's proposal while it is on, and is refused once it is off or the door is gone", async () => {
    const { store, client, door } = await service();
    const dismiss = (proposalId: string) => client.request({ action: "draft.proposal.dismiss", proposalId, mutation: OTHER });
    const propose = async (text: string) => {
      const note = store.create(`Plan\n${text}\n@tidy go`);
      const result = await client.request<DraftPatchResult>({ action: "draft.patch", blockId: note.id, revision: note.revision, patches: [spanOf(note.text, text, "beans here")], propose: "always", mutation: TIDY });
      if (result.outcome !== "proposed") throw new Error("expected a proposal");
      return result.proposalId;
    };
    const first = await propose("beans   here");
    await expect(dismiss(first)).rejects.toThrow("an agent dismisses only its own");

    const mine = await door("door-a");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    expect(await dismiss(first)).toMatchObject({ outcome: "dismissed" });
    // Still attributed to the agent who did it.
    const feed = await client.request<{ changes: Array<{ blockId?: string; actor?: { author: string; actorId?: string } }> }>({ action: "changes.since", sequence: 0 });
    expect(feed.changes.filter(change => change.blockId === first).at(-1)?.actor).toMatchObject({ author: "agent", actorId: "other-agent" });

    // The person takes it back: refused again.
    const second = await propose("beans    there");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: false });
    await expect(dismiss(second)).rejects.toThrow("an agent dismisses only its own");

    // The door goes: yolo goes with it, with no word from the door.
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    expect(await dismiss(await propose("beans     again"))).toMatchObject({ outcome: "dismissed" });
    const third = await propose("beans      once more");
    mine.leave();
    await eventually(async () => (await status(client)).yolo === undefined);
    expect((await status(client)).yolo).toBeUndefined();
    await expect(dismiss(third)).rejects.toThrow("an agent dismisses only its own");
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
    const { store, client, door } = await service();
    const note = store.create("Beds [season::spring]\nThe fence bed holds the beans.");
    const proposed = await client.request<DraftPatchResult>({ action: "draft.patch", blockId: note.id, revision: note.revision, patches: [spanOf(note.text, "Beds [season::spring]", "Beds")], policy: "prose", mutation: TIDY });
    if (proposed.outcome !== "proposed") throw new Error("expected a proposal");
    const apply = () => client.request({ action: "draft.proposal.apply", proposalId: proposed.proposalId, mutation: OTHER });
    await expect(apply()).rejects.toThrow("only the person applies that anyway");
    const mine = await door("door-a");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    expect(await apply()).toMatchObject({ outcome: "applied" });
    expect(store.require(note.id).text).toBe("Beds\nThe fence bed holds the beans.");
    const feed = await client.request<{ changes: Array<{ blockId?: string; kind: string; actor?: { author: string; actorId?: string } }> }>({ action: "changes.since", sequence: 0 });
    expect(feed.changes.filter(change => change.blockId === note.id && change.kind === "edit").at(-1)?.actor).toMatchObject({ author: "agent", actorId: "other-agent" });
  });

  test("the guard on dropped structure lets an agent's patch through, still written as the agent's", async () => {
    const { store, client, door } = await service();
    const page = store.create("Beds [page::beds]\nThe fence bed holds the beans. ^fence");
    store.create(`Plan\nsee ((${page.id}^fence))`);
    const patches = [spanOf(page.text, "beans. ^fence", "beans.")];
    await expect(client.request({ action: "draft.patch", blockId: page.id, revision: page.revision, patches, mutation: TIDY })).rejects.toThrow("would drop ^fence");
    const mine = await door("door-a");
    await client.request({ action: "agents.yolo", clientId: mine.clientId, on: true });
    await client.request({ action: "draft.patch", blockId: page.id, revision: page.revision, patches, mutation: TIDY });
    expect(store.require(page.id).text).toBe("Beds [page::beds]\nThe fence bed holds the beans.");
    const feed = await client.request<{ changes: Array<{ blockId?: string; kind: string; actor?: { author: string; actorId?: string } }> }>({ action: "changes.since", sequence: 0 });
    expect(feed.changes.filter(change => change.blockId === page.id && change.kind === "edit").at(-1)?.actor).toMatchObject({ author: "agent", actorId: "tidy" });
  });
});
