import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient, type OutlinerWatcher } from "../src/client";
import { launchService as launchScratchService, scratchServiceEnv, scratchServicePaths } from "./service-process";
import { TUI_RESOURCE_PRESENTATION_CONTEXT } from "../src/resource-presentation";
import type { InternResourceReceipt, ResourceSource } from "../src/types";

function launchService(root: string, env = scratchServiceEnv(root)) {
  const service = launchScratchService(env);
  return { ...service, startup: async () => (await service.startup()) !== null };
}

test("simultaneous hosts elect one owner and recover a real refresh after SIGKILL", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-service-owner-"));
  const env = scratchServiceEnv(root);
  const paths = scratchServicePaths(root);
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const http = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch() {
      received.resolve();
      await release.promise;
      return new Response("<h1>Held operation</h1>", { headers: { "content-type": "text/html" } });
    },
  });
  const services = [launchService(root, env), launchService(root, env)];
  let watcher: OutlinerWatcher | undefined;
  let observer: Database | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    const ready = await Promise.all(services.map((service) => service.startup()));
    if (!ready.some(Boolean)) throw new Error((await Promise.all(services.map((service) => service.stderr))).join("\n"));
    expect(ready.filter(Boolean)).toHaveLength(1);
    const winner = services[ready.indexOf(true)]!;
    const loser = services[ready.indexOf(false)]!;
    expect(await loser.child.exited).toBe(1);
    expect(await loser.stderr).toContain("already owned");

    const client = new OutlinerClient(paths.socket);
    const connected = Promise.withResolvers<void>();
    watcher = client.watch({
      client: {
        clientId: "ownership-proof", role: "detail", contextId: "ownership-proof",
        resourcePresentation: TUI_RESOURCE_PRESENTATION_CONTEXT,
      },
      onConnect: connected.resolve,
      onError: connected.reject,
      onEvent() {},
    });
    await connected.promise;
    const source = await client.request<ResourceSource>({
      action: "resource-sources.create",
      input: { name: "Crash fixture", provider: "web", boundary: { baseUrl: http.url.href } },
    });
    const { resource } = await client.request<InternResourceReceipt>({
      action: "resources.intern",
      input: { sourceId: source.id, address: { kind: "web", url: new URL("held", http.url).href } },
    });
    pending = client.request({
      action: "resources.refresh", resourceId: resource.id, destinationClientId: "ownership-proof",
    }).catch((error) => error);
    await Promise.race([
      received.promise,
      pending.then((result) => { throw new Error(`Refresh ended before the HTTP barrier: ${String(result)}`); }),
    ]);
    observer = new Database(paths.database, { readonly: true, create: false });
    expect(observer.query("SELECT freshness FROM web_resource_state WHERE resource_id = ?").get(resource.id))
      .toEqual({ freshness: "refreshing" });
    await watcher.stop();
    winner.child.kill("SIGKILL");
    await winner.child.exited;
    release.resolve();
    await pending;

    const successor = launchService(root, env);
    services.push(successor);
    expect(await successor.startup()).toBe(true);
    expect(observer.query("SELECT freshness, last_error FROM web_resource_state WHERE resource_id = ?").get(resource.id))
      .toEqual({ freshness: "failed", last_error: "Refresh interrupted before completion" });
    expect(await new OutlinerClient(paths.socket).request({ action: "resources.get", resourceId: resource.id }))
      .toMatchObject({ id: resource.id });
  } finally {
    release.resolve();
    await watcher?.stop();
    for (const service of services) {
      if (service.child.exitCode === null) service.child.kill("SIGKILL");
    }
    await Promise.all(services.map((service) => service.child.exited));
    await pending;
    observer?.close();
    await http.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
