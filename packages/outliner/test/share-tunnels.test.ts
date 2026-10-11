// Share links by Cloudflare Quick Tunnel (publish-tunnels.ts), with a fake cloudflared (test/fake-cloudflared.ts):
// the publisher starts one tunnel per `cloudflare` share, the start answers with the tunnel's link, the token opens
// pages only on that tunnel's host, and revoke, kill all and expiry each kill the process. Also: every public route
// that isn't a share stays read-only. Scratch service and publisher; the outline is made up.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { SHARES_METADATA_KEY } from "../src/share-sessions";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { scratchOutline } from "./scratch-outline";

const EDGE = "garden.example.test";
let root = "", fakeLog = "", fake = "", failing = "";
let store: OutlinerStore, server: OutlinerServer, client: OutlinerClient, publisher: Publisher;
let binary: string | undefined;
let hub: Block, swap: Block;

beforeAll(async () => {
  // The fake's made-up hosts never resolve: the link isn't held back for DNS here.
  process.env.EP0CH_TUNNEL_SKIP_DNS = "1";
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-tunnels-")));
  fakeLog = join(root, "cloudflared.log");
  fake = join(root, "cloudflared");
  failing = join(root, "cloudflared-failing");
  const script = join(import.meta.dir, "fake-cloudflared.ts");
  writeFileSync(fake, `#!/bin/sh\nFAKE_CLOUDFLARED_LOG='${fakeLog}' exec '${process.execPath}' '${script}' "$@"\n`);
  writeFileSync(failing, `#!/bin/sh\nFAKE_CLOUDFLARED_FAIL=1 FAKE_CLOUDFLARED_LOG='${fakeLog}' exec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(fake, 0o755); chmodSync(failing, 0o755);
  binary = fake;
  const paths = scratchOutline(root, { name: "garden" });
  store = new OutlinerStore(paths.database, { workspaceRoot: root });
  server = new OutlinerServer(store, paths.socket);
  await server.start();
  client = new OutlinerClient(paths.socket, 60_000);
  hub = store.create("Field notes\nWhat the garden did this autumn.", null, "user");
  swap = store.create("Seed swap\nBring the saved marigold seed.", hub.id, "user");
  publisher = new Publisher({ client, basePath: "/pub", publicUrl: `https://${EDGE}`, tunnels: true, tunnelSweepMs: 300, cloudflared: () => binary });
  await publisher.start();
});

afterAll(async () => {
  await publisher?.stop();
  await server?.close();
  store?.close();
  rmSync(root, { recursive: true, force: true });
});

const browser = { accept: "text/html" };
const get = (host: string, path: string) => publisher.handle(new Request(`http://${host}${path}`, { headers: { host, ...browser } }), "public");
/** Through a tunnel: its own ingress on loopback, as cloudflared reaches it (the Host is the tunnel's). */
const viaTunnel = (share: ShareSession, path: string) => {
  const running = publisher.tunnelProcesses().find((candidate) => candidate.shareId === share.id)!;
  return fetch(`http://127.0.0.1:${running.port}${path}`, { headers: { host: new URL(share.url!).host, ...browser } });
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const launched = () => existsSync(fakeLog) ? readFileSync(fakeLog, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { pid: number; args: string[] }) : [];
async function until<T>(what: string, check: () => T | undefined | false, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}
const start = (input: Record<string, unknown>) => client.request<{ share: ShareSession }>({ action: "shares.start", via: "cloudflare", ...input }).then((answer) => answer.share);
const pathOf = (share: ShareSession) => new URL(share.url!).pathname;
const pidOf = (share: ShareSession) => publisher.tunnelProcesses().find((running) => running.shareId === share.id)!.pid;

test("a tunnel per share: the start answers with its trycloudflare link, email-gated when asked; its token opens pages on that host only", async () => {
  const share = await start({ scope: hub.id, ttl: "2m", allowMail: "Fern@Example.org, @allotment.example" });
  expect(share).toMatchObject({ via: "cloudflare", allowMail: ["fern@example.org", "@allotment.example"], tunnel: { state: "up" } });
  expect(share.url).toMatch(/^https:\/\/fake-[a-z0-9]+-tunnel\.trycloudflare\.com\/s\/[A-Za-z0-9_-]{43}\/$/);
  const run = launched().at(-1)!;
  const port = publisher.tunnelProcesses().find((running) => running.shareId === share.id)!.port;
  expect(run.args).toEqual(["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`, "--allowed-mail", "fern@example.org,@allotment.example"]);
  expect(share.tunnel?.pid).toBe(run.pid);
  expect(alive(run.pid)).toBe(true);

  const host = new URL(share.url!).host;
  const page = await viaTunnel(share, pathOf(share));
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("What the garden did this autumn.");
  expect(page.headers.get("x-robots-tag")).toContain("noindex");
  // The same token on the public listener would skip the email gate: not there, by the edge's name or the tunnel's.
  expect((await get(EDGE, pathOf(share))).status).toBe(404);
  expect((await get(host, pathOf(share))).status).toBe(421);
  // And a tunnel's ingress answers its share alone: not an edge share's token, nor any other page.
  const { share: edge } = await client.request<{ share: ShareSession }>({ action: "shares.start", scope: hub.id });
  expect((await get(EDGE, pathOf(edge))).status).toBe(200);
  expect((await viaTunnel(share, pathOf(edge))).status).toBe(404);
  expect((await viaTunnel(share, "/p/" + hub.id)).status).toBe(404);

  // Revoke: the process is killed, and the link answers 410... from nowhere: the host is gone with it.
  await client.request({ action: "shares.revoke", shareId: share.id });
  await until("the tunnel to stop", () => !alive(run.pid));
  expect(publisher.tunnelProcesses().some((running) => running.shareId === share.id)).toBe(false);
  await client.request({ action: "shares.revoke", shareId: edge.id });
});

test("kill all stops every tunnel; expiry stops one without being asked", async () => {
  const [a, b] = [await start({ scope: hub.id }), await start({ scope: swap.id, comments: false })];
  const pids = [pidOf(a), pidOf(b)];
  expect(pids.every(alive)).toBe(true);
  await client.request({ action: "shares.revoke", all: true });
  await until("both tunnels to stop", () => pids.every((pid) => !alive(pid)));

  const late = await start({ scope: hub.id, ttl: "2m" });
  const pid = pidOf(late);
  const kept = JSON.parse(store.readMetadata(SHARES_METADATA_KEY)!) as { sessions: ShareSession[] };
  for (const session of kept.sessions) if (session.id === late.id) session.expiresAt = new Date(Date.now() + 500).toISOString();
  store.writeMetadata(SHARES_METADATA_KEY, JSON.stringify(kept));
  // Nothing tells the publisher: its own reading of the list stops the tunnel at its time.
  await until("the expired tunnel to stop", () => !alive(pid));
});

test("no cloudflared, or one that fails: refused with what to do, and the share ends", async () => {
  binary = undefined;
  await expect(start({ scope: hub.id })).rejects.toThrow(/cloudflared isn't installed here: install it/);
  binary = failing;
  await expect(start({ scope: hub.id })).rejects.toThrow(/cloudflared exited/);
  binary = fake;
  expect((await client.request<{ shares: ShareSession[] }>({ action: "shares.list" })).shares).toEqual([]);
  // allowMail is the tunnel's gate: refused on the edge, and refused when it isn't an email or domain.
  await expect(client.request({ action: "shares.start", scope: hub.id, allowMail: "fern@example.org" })).rejects.toThrow(/via cloudflare/);
  await expect(start({ scope: hub.id, allowMail: "fern; rm -rf" })).rejects.toThrow(/emails/);
});

test("every public route that isn't a share stays read-only", async () => {
  const post = (path: string) => publisher.handle(new Request(`http://${EDGE}${path}`, {
    method: "POST", headers: { host: EDGE, origin: `https://${EDGE}`, "content-type": "application/json" },
    body: JSON.stringify({ page: hub.id, action: "comment", quote: "", body: "From outside." }),
  }), "public");
  for (const path of ["/p/" + hub.id, "/share/p/" + hub.id, "/_marginalia/write", "/share/_marginalia/write", "/shares/revoke", "/share/shares/start", "/index.json", `/s/${"x".repeat(43)}/_marginalia/write`]) {
    expect([404, 405]).toContain((await post(path)).status);
  }
  const children = await client.request<Block[]>({ action: "children", parentId: hub.id });
  expect(children.map((block) => block.id)).toEqual([swap.id]);
});
