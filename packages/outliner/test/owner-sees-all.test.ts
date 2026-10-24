// PIE-1265: signed in as the owner, the site draws every note as it is. `[publish::never]` means "never share this
// outside", so a signed-in session reads a never note, lists it in its parent's folder, searches it and sees the replies
// on it; an unsigned tailnet reader, the public listener and a share link keep the lock. One scratch service and
// publisher; the outline is made up.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { Publisher, type SignedIn } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { scratchOutline } from "./scratch-outline";

const HOST = "garden.tail0000.ts.net";
const ORIGIN = `https://${HOST}`;
let root = "";
let store: OutlinerStore;
let server: OutlinerServer;
let client: OutlinerClient;
let publisher: Publisher;
let hub: Block, ledger: Block, receipts: Block, tour: Block;

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-owner-")));
  const workspace = join(root, "garden");
  mkdirSync(join(workspace, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "marginalia"), join(workspace, "extensions", "marginalia"), { recursive: true });
  const paths = scratchOutline(root, { name: "garden", folder: workspace });
  store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  server = new OutlinerServer(store, paths.socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80 });
  await server.start();
  client = new OutlinerClient(paths.socket, 15_000);
  await client.request({ action: "extensions.list", reload: true });
  hub = store.create("Field notes [page::Field Notes]\nWhat the garden did this autumn.", null, "user");
  store.create("Moth survey\nThe stock drew hawk-moths after dusk.", hub.id, "user");
  ledger = store.create("Private ledger [publish::never]\nWhat the plots cost.", hub.id, "user");
  receipts = store.create("Plot receipts\nTwelve pounds for the shed padlock.", ledger.id, "user");
  tour = store.create(`Garden tour [publish::tour]\n!((${ledger.id})) and ((${ledger.id}|the ledger))`, null, "user");
  store.create("Spare key under the brick [publish::never]", tour.id, "user");
  store.create("Lavender by the path", tour.id, "user");
  publisher = new Publisher({ client, basePath: "/pub", publicUrl: "/share" });
  await publisher.start();
});

afterAll(async () => {
  await publisher?.stop();
  await server?.close();
  store?.close();
  rmSync(root, { recursive: true, force: true });
});

const browser = { accept: "text/html,application/xhtml+xml" };
const session: SignedIn = { sessionId: "web-owner-1", origin: ORIGIN };
type Reader = "owner" | "tailnet" | "public";
const get = (path: string, as: Reader, headers: Record<string, string> = browser) =>
  publisher.handle(new Request(`http://${HOST}${path}`, { headers: { host: HOST, ...headers } }), as === "public" ? "public" : "tailnet", undefined, as === "owner" ? session : undefined);
const text = async (path: string, as: Reader, headers?: Record<string, string>) => (await get(path, as, headers)).text();

test("signed in, a never note opens as it is, with the notes under it; an unsigned reader still gets nothing", async () => {
  const owner = await get(`/pub/p/${ledger.id}`, "owner");
  expect(owner.status).toBe(200);
  const page = await owner.text();
  expect(page).toContain("What the plots cost.");
  expect(page).toContain("Plot receipts");
  expect(await text(`/pub/p/${receipts.id}`, "owner")).toContain("Twelve pounds for the shed padlock.");
  // Unsigned on the tailnet, and on the public listener, the lock holds (and nothing of it leaks into the answer).
  for (const as of ["tailnet", "public"] as const) {
    for (const id of [ledger.id, receipts.id]) expect((await get(`/pub/p/${id}`, as)).status).toBe(404);
  }
});

test("signed in, a never note is a row in its parent's folder; unsigned, a locked row with no title", async () => {
  const owner = await text("/pub/p/Field%20Notes", "owner");
  expect(owner).not.toContain("locked note");
  expect(owner).toContain("Private ledger");
  expect(owner).toContain(`/pub/p/${ledger.id}`);
  expect(owner).toContain("1 note");
  const outsider = await text("/pub/p/Field%20Notes", "tailnet");
  expect(outsider).toContain("locked note");
  expect(outsider).not.toContain("Private ledger");
  expect(outsider).not.toContain(`/pub/p/${ledger.id}`);
});

test("signed in, a page draws its never embed, link and child rows; unsigned they say locked note", async () => {
  const owner = await text("/pub/p/tour", "owner", {});
  expect(owner).not.toContain("locked note");
  for (const words of ["What the plots cost.", "Spare key under the brick", "Lavender by the path"]) expect(owner).toContain(words);
  const html = await text("/pub/p/tour?view=html", "owner");
  expect(html).not.toContain("locked note");
  expect(html).toContain("What the plots cost.");
  const outsider = await text("/pub/p/tour", "tailnet", {});
  expect(outsider).toContain("locked note");
  for (const words of ["What the plots cost.", "Spare key"]) expect(outsider).not.toContain(words);
  const folded = await text(`/pub/p/${tour.id}`, "owner");
  expect(folded).toContain("Spare key under the brick");
  expect(await text(`/pub/p/${tour.id}`, "tailnet")).not.toContain("Spare key");
});

test("signed in, search finds a never note and what is under it; unsigned it does not", async () => {
  const found = async (as: Reader, q: string) =>
    ((await (await get(`/pub/search?q=${encodeURIComponent(q)}&format=json`, as, {})).json()) as { hits: { id: string }[] }).hits.map((hit) => hit.id);
  expect(await found("owner", "plots cost")).toContain(ledger.id);
  expect(await found("owner", "padlock")).toContain(receipts.id);
  expect(await found("tailnet", "plots cost")).not.toContain(ledger.id);
  expect(await found("tailnet", "padlock")).not.toContain(receipts.id);
});

test("signed in, a reply on a never note is in Recent replies; unsigned it is not", async () => {
  const wrote = await publisher.handle(new Request(`http://${HOST}/pub/_marginalia/write`, {
    method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ page: ledger.id, action: "comment", quote: "plots cost", body: "Is this the whole year?", requestId: "owner-ask-1" }),
  }), "tailnet", undefined, session);
  const asked = await wrote.json() as { ok: boolean; thread: string };
  expect(asked.ok).toBe(true);
  await client.request({ action: "annotations.reply", requestId: "owner-fern-1", author: "agent", provenance: { actorId: "fern" }, input: { annotationId: asked.thread, body: "Only to September.", source: "agent" } });
  expect(await text("/pub/replies", "owner")).toContain("Only to September.");
  expect(await text("/pub/replies", "tailnet")).not.toContain("Only to September.");
  const threads = async (as: Reader) => (await get(`/pub/_marginalia/threads?page=${ledger.id}`, as, {})).status;
  expect(await threads("owner")).toBe(200);
  expect(await threads("tailnet")).toBe(404);
});

test("a share link keeps the lock, whoever follows it", async () => {
  await client.request({ action: "shares.start", scope: hub.id, ttl: "5m" });
  const kept = JSON.parse(store.readMetadata("share_sessions")!) as { sessions: { token: string; state: string }[] };
  const base = `/s/${kept.sessions.find((session) => session.state === "active")!.token}`;
  const folder = await text(`${base}/`, "public");
  expect(folder).toContain("What the garden did this autumn.");
  expect(folder).toContain("locked note");
  expect(folder).not.toContain("Private ledger");
  expect((await get(`${base}/p/${ledger.id}`, "public")).status).toBe(404);
  // The owner's session reaching a share path is still a share reader.
  expect((await get(`${base}/p/${ledger.id}`, "owner")).status).toBe(404);
  // And a share of a never note can't be started: never means never outside.
  await expect(client.request({ action: "shares.start", scope: ledger.id, ttl: "5m" })).rejects.toThrow(/publish::never/);
});
