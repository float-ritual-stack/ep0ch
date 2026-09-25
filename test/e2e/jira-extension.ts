import assert from "node:assert/strict";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  InternResourceReceipt,
  ResourceDescription,
} from "../../src/types";
import { runHerdrScenario } from "./herdr-runner";
// A loopback fixture only. LANG is a harmless inherited value used as the synthetic credential.
const previousLang = process.env.LANG;
process.env.LANG = "C.UTF-8";
let seenBasic = false;
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    seenBasic =
      req.headers.get("authorization") ===
      "Basic " + Buffer.from("fixture@example.test:C.UTF-8").toString("base64");
    if (!seenBasic) return new Response("", { status: 403 });
    return Response.json({
      id: "10001",
      key: "PC-762",
      fields: {
        summary: "External Jira installation",
        updated: "2026-09-25T12:00:00Z",
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Basic auth and readable issue content through the installed extension.",
                },
              ],
            },
          ],
        },
        status: { name: "Doing" },
        labels: [],
      },
    });
  },
});
const origin = `http://127.0.0.1:${provider.port}`;
try {
  const result = await runHerdrScenario({
    name: "jira-extension",
    async prepare(root) {
      const extension = join(root, "installed-jira");
      await cp(join(import.meta.dir, "../../extensions/jira"), extension, {
        recursive: true,
      });
      const manifestPath = join(extension, "manifest.json");
      const manifest = await Bun.file(manifestPath).json();
      manifest.command = [process.execPath, "jira.ts"];
      await writeFile(manifestPath, JSON.stringify(manifest));
      const configDir = join(dirname(root), "xdg-config/pi-herdr-outliner");
      await mkdir(configDir, { recursive: true });
      await writeFile(
        join(configDir, "resource-extensions.json"),
        JSON.stringify({
          version: 1,
          providers: {
            jira: {
              manifest: manifestPath,
              enabled: true,
              config: { authMode: "basic", email: "fixture@example.test" },
              credentials: { token: { env: "LANG" } },
            },
          },
        }),
      );
    },
    async run(s) {
      await s.attachClient();
      await s.client.request({
        action: "resource-sources.create",
        input: {
          name: "Installed Jira",
          provider: "jira",
          boundary: { origin, project: "PC" },
        },
      });
      const receipt = await s.client.request<InternResourceReceipt>({
        action: "resources.follow-authored",
        reference: { kind: "jira", key: "PC-762" },
      });
      const clients = await s.registrations();
      const detail = clients.find((c) => c.runtime?.paneId === s.panes.detail)!;
      const tree = clients.find((c) => c.runtime?.paneId === s.panes.tree)!;
      await s.client.request({
        action: "navigation.dispatch",
        sourceClientId: tree.clientId,
        destination: { clientId: detail.clientId, region: "detail" },
        intent: "open",
        target: { kind: "resource", resourceId: receipt.resource.id },
      });
      await s.keys(s.panes.detail, "r");
      await s.waitVisible(s.panes.detail, "External Jira installation");
      await s.waitVisible(
        s.panes.detail,
        "Basic auth and readable issue content",
      );
      assert(seenBasic);
      const description = await s.client.request<ResourceDescription>({
        action: "resources.describe",
        target: { kind: "resource", resourceId: receipt.resource.id },
        destinationClientId: detail.clientId,
      });
      assert.equal(
        description.remoteEntity?.externalUrl,
        origin + "/browse/PC-762",
      );
      await s.checkpoint("jira-installed-basic");
      const remote = await s.openRemoteBrowsingContext({
        detailTransport: "forwarded",
      });
      const remoteDetail = (await s.registrations()).find(
        (c) => c.runtime?.paneId === remote.detail,
      )!;
      await s.client.request({
        action: "navigation.dispatch",
        sourceClientId: tree.clientId,
        destination: { clientId: remoteDetail.clientId, region: "detail" },
        intent: "open",
        target: { kind: "resource", resourceId: receipt.resource.id },
      });
      await s.waitVisible(remote.detail, "External Jira installation");
      await s.checkpoint("jira-forwarded-reader");
    },
  });
  console.log(JSON.stringify(result));
  if (result.status !== "passed") process.exitCode = 1;
} finally {
  provider.stop(true);
  if (previousLang === undefined) delete process.env.LANG;
  else process.env.LANG = previousLang;
}
