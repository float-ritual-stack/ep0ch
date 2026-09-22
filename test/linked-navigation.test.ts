import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { NavigationLinkState, OutlinerClientRegistration, OutlinerEvent, OutlinerNavigationDispatch, OutlinerViewAddress } from "../src/types";

test("explicit logical links fan in, never forward receipt, preserve one-off choices, and reject protected or closed destinations", async () => {
  const root = mkdtempSync("/tmp/outliner-links-");
  const store = new OutlinerStore(join(root, "db.sqlite"));
  const server = new OutlinerServer(store, join(root, "app.sock"));
  await server.start();
  const client = new OutlinerClient(join(root, "app.sock"));
  const events: OutlinerEvent[] = [];
  const watchers = [];
  const view = (clientId: string, region: "tree" | "detail" = "detail"): OutlinerViewAddress => ({clientId, region});
  const source = view("A", "tree");
  const registrations: OutlinerClientRegistration[] = [
    ...["A", "B", "C"].map(clientId => ({clientId, role: "tree" as const, contextId: clientId})),
    ...["X", "Y"].map(clientId => ({clientId, role: "detail" as const, contextId: clientId})),
    {clientId: "composed", role: "composed", contextId: "composed"},
  ].map(client => ({...client, runtime: {hostname: "test-host", workspaceId: "workspace", tabId: "tab"}})) as OutlinerClientRegistration[];
  try {
    for (const registration of registrations) {
      const connected = Promise.withResolvers<void>();
      watchers.push(client.watch({client: registration, onConnect: connected.resolve, onError: connected.reject, onEvent: event => { if (registration.clientId === "A") events.push(event); }}));
      await connected.promise;
    }
    const block = store.create("Target");
    const target = {kind: "block" as const, blockId: block.id};
    const open = (clientId: string, extra = {}) => client.request<OutlinerNavigationDispatch>({action: "navigation.dispatch", sourceClientId: clientId, intent: "open", target, ...extra});
    await expect(open("A")).rejects.toThrow("No linked destination");
    for (const clientId of ["A", "B", "C"]) await client.request({action: "navigation.link.set", source: view(clientId, "tree"), destination: view("X")});
    await client.request({action: "navigation.link.set", source: view("X"), destination: view("Y")});
    for (const clientId of ["A", "B", "C"]) expect((await open(clientId)).targetClientId).toBe("X");
    expect(events.filter(e => e.command?.targetClientId === "Y")).toHaveLength(0);
    expect((await open("X")).targetClientId).toBe("Y");
    expect((await open("A", {destination: view("Y")})).resolution).toBe("chosen");
    expect((await client.request<NavigationLinkState>({action: "navigation.link.get", source})).destination).toEqual(view("X"));
    await client.request({action: "clients.update", clientId: "X", runtime: {paneX: 999, tabId: "moved"}, locked: true});
    expect((await open("A")).targetClientId).toBe("X");
    await client.request({action: "clients.update", clientId: "X", navigationProtection: "active draft"});
    await expect(open("A")).rejects.toThrow("active draft");
    await client.request({action: "clients.update", clientId: "X", navigationProtection: null});
    await client.request({action: "navigation.link.set", source: view("composed", "tree"), destination: view("X")});
    await client.request({action: "navigation.link.set", source: view("composed"), destination: view("Y")});
    await expect(open("composed")).rejects.toThrow("sourceRegion");
    expect((await open("composed", {sourceRegion: "tree"})).targetClientId).toBe("X");
    expect((await open("composed", {sourceRegion: "detail"})).targetClientId).toBe("Y");
    writeFileSync(join(root, "source.md"), "Pinned bytes");
    const resource = store.resources.internFilesystem({path: join(root, "source.md")});
    const description = store.resources.describe(resource.resource.id, true);
    const resourceTarget = {kind: "resource" as const, resourceId: resource.resource.id, revision: description.filesystem!.revision};
    const dispatched = await client.request<OutlinerNavigationDispatch>({action: "navigation.dispatch", sourceClientId: "A", intent: "open", target: resourceTarget});
    expect(dispatched.command).toMatchObject({target: resourceTarget, targetClientId: "X"});
    await watchers[3]!.stop();
    await expect(open("A")).rejects.toThrow("No linked destination");
    expect(store.require(block.id).text).toBe("Target");
  } finally {
    for (const watcher of watchers) await watcher.stop();
    await server.close(); store.close(); rmSync(root, {recursive: true, force: true});
  }
});
