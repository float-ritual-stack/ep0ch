// Pictures a note names are copied to the media bucket on save and every page serves them from there (PIE-1634). One
// scratch service and publisher over a made-up outline, and a fake S3 (test/fake-s3.ts): never a real bucket or key.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MediaCopies, MediaRead } from "@ep0ch/outline-core/media-copy";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { mediaBucketConfig } from "../src/media-bucket";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { fakeS3 } from "./fake-s3";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

// Enough of a PNG for a type check; two different pictures.
const MOTH = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1]);
const KITE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 2]);
const HOST = "garden.tail0000.ts.net:8443";

async function setup(options: { bucket?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-media-bucket-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "garden"), inbox = join(root, "inbox", "screenshots");
  mkdirSync(join(workspace, "images"), { recursive: true });
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(workspace, "images", "moth.png"), MOTH);
  writeFileSync(join(inbox, "kite.png"), KITE);
  const s3 = fakeS3();
  cleanups.push(() => s3.stop());
  const paths = scratchOutline(root, { name: "garden", folder: workspace });
  const store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  const server = new OutlinerServer(store, paths.socket);
  server.media.env = options.bucket === false ? { WITH_SECRETS_DIR: "/nonexistent" } : s3.env;
  await server.start();
  const client = new OutlinerClient(paths.socket, 15_000);
  // No --root: the inbox folder is outside every root this publisher has.
  const publisher = new Publisher({ client, basePath: "/pub", publicUrl: `https://${HOST}/share` });
  await publisher.start();
  cleanups.push(async () => { await publisher.stop(); await server.close(); store.close(); });
  const get = (path: string, audience: "tailnet" | "public" = "tailnet", signedIn = false) =>
    publisher.handle(new Request(`http://${HOST}${path}`, { headers: { host: HOST, accept: "text/html" } }), audience, undefined, signedIn ? { sessionId: "web-garden" } : undefined);
  const write = (text: string) => client.request<Block>({ action: "create", text, author: "user" } as never);
  return { root, workspace, inbox, s3, store, server, client, publisher, get, write };
}

test("a saved note's pictures land in the bucket once each, by their sha256, wherever they are on the machine", async () => {
  const { s3, server, client, inbox, store, write } = await setup();
  const note = await write(`Moth night [publish::public:moth-night]\n[img::images/moth.png] [alt::a moth]\n- [img::${join(inbox, "kite.png")}] [alt::a kite]`);
  await server.media.settled();
  const hash = (bytes: Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  expect(s3.puts.sort()).toEqual([`sha256/${hash(MOTH)}`, `sha256/${hash(KITE)}`].sort());
  expect(s3.objects.get(`sha256/${hash(KITE)}`)?.type).toBe("image/png");
  // Saved again, unchanged: nothing is uploaded.
  const now = store.require(note.id);
  await client.request({ action: "update", blockId: note.id, text: `${now.text}\nThe sheet stayed up till two.`, expectedRevision: now.revision, mutation: { author: "user" } });
  await server.media.settled();
  expect(s3.puts).toHaveLength(2);
  // Another note naming the same picture: still nothing.
  await write(`Kite again\n[img::${join(inbox, "kite.png")}]`);
  await server.media.settled();
  expect(s3.puts).toHaveLength(2);
  // A picture changed on disk gets a new hash on the next save.
  writeFileSync(join(inbox, "kite.png"), MOTH.slice(0, 12));
  const again = store.require(note.id);
  await client.request({ action: "update", blockId: note.id, text: `${again.text}\nRepainted.`, expectedRevision: again.revision, mutation: { author: "user" } });
  await server.media.settled();
  expect(s3.puts).toHaveLength(3);
  const copies = await client.request<MediaCopies>({ action: "media.copies", paths: ["images/moth.png", join(inbox, "kite.png"), "images/none.png"] } as never);
  expect(copies.bucket).toBe(true);
  expect(copies.copies.map((copy) => [copy.path, copy.copied])).toEqual([["images/moth.png", true], [join(inbox, "kite.png"), true]]);
  // The record is beside the block, never a property the author sees.
  expect(store.require(note.id).text).not.toContain("sha256");
});

test("every page serves a copied picture from the bucket: signed in, signed out and through a share, with no publish root", async () => {
  const { s3, server, client, inbox, write, get } = await setup();
  const note = await write(`Kite day [publish::public:kite-day]\nWhat flew.\n[img::${join(inbox, "kite.png")}] [alt::a red kite]`);
  await server.media.settled();
  for (const [audience, signedIn, path] of [["tailnet", true, "/pub/p/kite-day"], ["tailnet", false, "/pub/p/kite-day"], ["public", false, "/share/p/kite-day"]] as const) {
    const html = await (await get(`${path}?view=html`, audience, signedIn)).text();
    expect(html).toContain(`alt="a red kite"`);
  }
  const image = await get(`/pub/p/${note.id}/media/2`);
  expect(image.status).toBe(302);
  const location = image.headers.get("location")!;
  expect(location).toStartWith(`${s3.url}/${s3.bucket}/sha256/`);
  expect(location).toContain("X-Amz-Signature=");
  expect(new Uint8Array(await (await fetch(location)).arrayBuffer())).toEqual(KITE);
  expect((await get(`/share/p/${note.id}/media/2`, "public")).status).toBe(302);
  const { share } = await client.request<{ share: ShareSession }>({ action: "shares.start", scope: note.id } as never);
  const token = /\/s\/([^/]+)\/$/.exec(share.url!)![1]!;
  const shared = await (await get(`/share/s/${token}/?view=html`, "public")).text();
  expect(shared).toContain(`alt="a red kite"`);
  expect((await get(`/share/s/${token}/p/${note.id}/media/2`, "public")).status).toBe(302);
});

test("a picture whose file is gone still serves its copy, and the door reads it from the bucket (a laptop's picture on another machine)", async () => {
  const { server, client, inbox, write, get } = await setup();
  const note = await write(`Kite\n[img::${join(inbox, "kite.png")}]`);
  await server.media.settled();
  rmSync(join(inbox, "kite.png"));
  expect((await get(`/pub/p/${note.id}/media/1`)).status).toBe(302);
  const read = await client.request<MediaRead>({ action: "media.read", path: join(inbox, "kite.png") } as never);
  expect(read).toMatchObject({ from: "bucket", mime: "image/png" });
  expect(new Uint8Array(Buffer.from(read.base64, "base64"))).toEqual(KITE);
  await expect(client.request({ action: "media.read", path: join(inbox, "never.png") } as never)).rejects.toThrow(/no copy of it is in the media bucket/);
});

test("with no bucket a page reads the file as before, and the owner hears why one outside the roots doesn't show", async () => {
  const { server, inbox, write, get, workspace } = await setup({ bucket: false });
  const note = await write(`Kite day [publish::public:kite-day]\n[img::${join(inbox, "kite.png")}] [alt::a red kite]\n[img::images/moth.png]`);
  await server.media.settled();
  expect((await get(`/pub/p/${note.id}/media/2`)).status).toBe(200);
  expect((await get(`/pub/p/${note.id}/media/1`)).status).toBe(404);
  const owner = await (await get("/pub/p/kite-day?view=html", "tailnet", true)).text();
  expect(owner).toContain("outside this publisher&#39;s roots");
  expect(workspace).toBeTruthy();
});

test("the bucket's settings: the environment first, then the with-secrets group file; a half setup names what's missing", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "outliner-media-secrets-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  expect(mediaBucketConfig({ WITH_SECRETS_DIR: dir })).toBeNull();
  writeFileSync(join(dir, "hetzner-s3.env"), "AWS_ACCESS_KEY_ID=fake-id\nAWS_SECRET_ACCESS_KEY=fake-secret\nEP0CH_MEDIA_BUCKET=scratch-media\nEP0CH_MEDIA_ENDPOINT=https://hel1.example.test/\n", { mode: 0o600 });
  expect(mediaBucketConfig({ WITH_SECRETS_DIR: dir })).toEqual({ bucket: "scratch-media", endpoint: "https://hel1.example.test", region: "hel1", accessKeyId: "fake-id", secretAccessKey: "fake-secret" });
  expect(mediaBucketConfig({ WITH_SECRETS_DIR: dir, EP0CH_MEDIA_BUCKET: "other", EP0CH_MEDIA_REGION: "eu" })).toMatchObject({ bucket: "other", region: "eu" });
  const half = mediaBucketConfig({ WITH_SECRETS_DIR: "/nonexistent", EP0CH_MEDIA_BUCKET: "scratch-media" });
  expect(half).toEqual({ problem: expect.stringContaining("EP0CH_MEDIA_ENDPOINT, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY") });
  expect(JSON.stringify(half)).not.toContain("fake-secret");
});
