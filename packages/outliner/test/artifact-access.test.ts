// Who may read an artifact (PIE-1266, the access model): signed in, the owner reads every artifact; unsigned and
// unshared, the artifact host answers a sign-in prompt, never the artifact and never a bare 404; a share of one artifact
// opens it; a share of a page opens the artifacts that page frames and no others; revoking a share closes both.
// Everything goes through real HTTP: the publisher answers pages, the artifact host (artifact-server.ts) is a real
// listener, and a "browser" follows a page's frame to it. Artifacts, notes and names are made up.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { artifactKey, grantPath, OWNER_GRANT_MS } from "../src/artifact-grants";
import { artifactResponse, sharesFromSocket } from "../src/artifact-server";
import { OutlinerClient } from "../src/client";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlineHost } from "../src/outline-host";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { SHARES_METADATA_KEY } from "../src/share-sessions";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { SignInGate } from "../src/web-signin";
import { scratchOutline } from "./scratch-outline";

const HOST = "garden.example.test";
let root = "";
let store: OutlinerStore;
let server: OutlinerServer;
let client: OutlinerClient;
let publisher: Publisher;
let host: ReturnType<typeof Bun.serve>;
let origin = "";
/** The signed-in web client's origin; shares are opened on the outline's own public host (HOST). */
const WEB = "https://my.example.test";
let hub: Block, survey: Block, locked: Block, elsewhere: Block, published: Block;
const was = { artifacts: process.env.EP0CH_ARTIFACT_ORIGIN, web: process.env.EP0CH_WEB_URL };

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-artifact-access-")));
  const workspace = join(root, "garden");
  mkdirSync(workspace);
  const paths = scratchOutline(root, { folder: workspace });
  store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  server = new OutlinerServer(store, paths.socket);
  await server.start();
  client = new OutlinerClient(paths.socket, 15_000);
  host = Bun.serve({ port: 0, fetch: request => artifactResponse(join(root, ".artifacts"), request, "'self'", { shareOpen: sharesFromSocket(paths.socket), web: `${WEB}/pub` }) });
  origin = host.url.origin;
  process.env.EP0CH_ARTIFACT_ORIGIN = origin;
  for (const [name, text] of [["moth-site", "Moth site"], ["lantern", "Lantern"], ["vault", "Vault"]]) {
    await client.request({ action: "artifacts.put", name, files: { "index.html": `<h1>${text}</h1>`, "assets/theme.css": "body{color:purple}" } });
  }
  hub = store.create("Field notes [page::Field Notes]\nWhat the garden did this autumn.", null, "user");
  survey = store.create("Moth survey\n[artifact::moth-site]", hub.id, "user");
  locked = store.create("Private ledger [publish::never]\n[artifact::vault]", hub.id, "user");
  elsewhere = store.create("Other notes\n[artifact::lantern]", null, "user");
  published = store.create("Open letter [publish::public]\n[artifact::moth-site]", null, "user");
  process.env.EP0CH_WEB_URL = WEB;
  publisher = new Publisher({ client, basePath: "/pub", publicUrl: `https://${HOST}/share`, url: `${WEB}/pub` });
  await publisher.start();
});

afterAll(async () => {
  await publisher?.stop();
  host?.stop(true);
  await server?.close();
  store?.close();
  for (const [key, value] of [["EP0CH_ARTIFACT_ORIGIN", was.artifacts], ["EP0CH_WEB_URL", was.web]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

const html = { accept: "text/html" };
/** The signed-in owner's browser, at the web client. */
const owner = (path: string, method = "GET") =>
  publisher.handle(new Request(`${WEB}/pub${path}`, { method, headers: { host: "my.example.test", ...html } }), "tailnet", undefined, { sessionId: "web1", origin: WEB });
/** An outsider's browser, at the outline's public host: no session, only the link. */
const outsider = (path: string, method = "GET") =>
  publisher.handle(new Request(`https://${HOST}${path}`, { method, headers: { host: HOST, ...html } }), "public");
/** The iframes a page draws, as a browser would load them. */
const frames = (page: string) => [...page.matchAll(/<iframe src="([^"]*)"/g)].map(match => match[1]!.replace(/&amp;/g, "&"));
const shareOf = async (input: Record<string, unknown>) => {
  const { share } = await client.request<{ share: ShareSession }>({ action: "shares.start", ...input });
  return { share, base: `/s/${/\/s\/([^/]+)\/$/.exec(share.url!)![1]}` };
};

test("signed in, a note's page frames its artifact and every artifact has a page of its own that reads", async () => {
  const page = await (await owner(`/p/${survey.id}`)).text();
  const [frame] = frames(page);
  expect(frames(page)).toHaveLength(1);
  expect(frame).toStartWith(origin);
  const loaded = await fetch(frame!);
  expect(loaded.status).toBe(200);
  expect(await loaded.text()).toContain("Moth site");
  // The page's own files load below the same path (the frame's relative links work).
  expect(await (await fetch(new URL("assets/theme.css", frame!))).text()).toBe("body{color:purple}");
  // The artifact host's address is the frame and nothing else on the page: "open full page" is this site's route.
  expect(page.split(origin).length - 1).toBe(1);
  expect(page).toContain(`href="/pub/p/${survey.id}/artifact/1"`);
  const alone = await owner(`/p/${survey.id}/artifact/1`);
  expect(alone.status).toBe(200);
  expect(await (await fetch(frames(await alone.text())[0]!)).text()).toContain("Moth site");
  // An artifact no note frames, by its own page.
  const own = await owner("/a/lantern/");
  expect(own.status).toBe(200);
  expect(await (await fetch(frames(await own.text())[0]!)).text()).toContain("Lantern");
  expect((await owner("/a/nothing-here/")).status).toBe(404);
});

test("what the store hands out is the web client's page for an artifact, never the artifact host's address", async () => {
  const put = await client.request<ArtifactInfo>({ action: "artifacts.put", name: "moth-site", files: { "index.html": "<h1>Moth site</h1>", "assets/theme.css": "body{color:purple}" } });
  expect(put.url).toBe(`${WEB}/pub/a/moth-site/`);
  const { artifacts } = await client.request<{ artifacts: ArtifactInfo[] }>({ action: "artifacts.list" });
  for (const row of artifacts) expect(row.url).toStartWith(`${WEB}/pub/a/`);
  const shown = await client.request<ArtifactInfo>({ action: "artifacts.show", name: "lantern" });
  expect(shown.url).toBe(`${WEB}/pub/a/lantern/`);
  expect(shown.frame).toBeUndefined();
  const snapshot = await client.request<ArtifactInfo>({ action: "artifacts.snapshot", name: "lantern" });
  expect(snapshot.url).toBe(`${WEB}/pub/a/${encodeURIComponent("lantern@1")}/`);
  expect(JSON.stringify([put, artifacts, shown, snapshot])).not.toContain(origin);
  // A snapshot frozen before this kept the artifact host's address in its record: it is never handed out again.
  const record = join(root, ".artifacts/snapshots/lantern/1/meta.json");
  writeFileSync(record, JSON.stringify({ ...JSON.parse(readFileSync(record, "utf8")), url: `${origin}/3f2b6c1e-0000-4000-8000-000000000001/lantern%401/` }));
  const { versions } = await client.request<{ versions: ArtifactInfo[] }>({ action: "artifacts.versions", name: "lantern" });
  expect(versions[0]!.url).toBe(`${WEB}/pub/a/${encodeURIComponent("lantern@1")}/`);
});

test("unsigned and unshared, the artifact host asks for a sign-in: bare, old, forged and expired links all get the prompt, whether or not the artifact exists", async () => {
  const key = artifactKey(join(root, ".artifacts"), true)!;
  const frame = frames(await (await owner("/a/lantern/")).text())[0]!;
  const refused = [
    `${origin}/`,
    `${origin}/lantern/`,
    // The old unguessable address: its id means nothing now.
    `${origin}/3f2b6c1e-0000-4000-8000-000000000001/lantern/`,
    `${origin}/3f2b6c1e-0000-4000-8000-000000000001/no-such-artifact/`,
    // Tampered, retargeted, expired.
    frame.replace(/\.[A-Za-z0-9_-]+\/lantern/, ".AAAA/lantern"),
    frame.replace("/lantern/", "/moth-site/"),
    `${origin}${grantPath(key, { owner: true }, "lantern", { now: Date.now() - 2 * OWNER_GRANT_MS })}`,
    `${origin}/k/9999999999.bogus/no-such-artifact/`,
  ];
  for (const url of refused) {
    const answer = await fetch(url);
    expect({ url: url.replace(origin, ""), status: answer.status }).toEqual({ url: url.replace(origin, ""), status: 401 });
    const body = await answer.text();
    expect(body).toContain("Sign in");
    expect(body).not.toContain("Lantern</h1>");
  }
  // A named artifact's prompt leads to its page, where the sign-in comes back to it.
  expect(await (await fetch(`${origin}/3f2b6c1e-0000-4000-8000-000000000001/lantern/`)).text()).toContain(`${WEB}/pub/a/lantern/`);
  // And the web client itself does the signing in: unsigned, its artifact page is the sign-in page, coming back to it.
  const gate = new SignInGate({
    settings: { origin: WEB, issuer: "https://issuer.example.test", clientId: "fictional", allowedSubjects: [], home: "/pub/" },
    request: input => client.request(input as any), serve: request => publisher.handle(request),
  });
  const prompt = await gate.handle(new Request(`${WEB}/pub/a/lantern/`, { headers: { host: "my.example.test", ...html } }));
  expect(prompt.status).toBe(401);
  expect(await prompt.text()).toContain("/signin/start?next=%2Fpub%2Fa%2Flantern%2F");
});

test("a share of one artifact opens that artifact full-bleed and nothing else, and lasts until it is revoked", async () => {
  // Until revoked, whether it says so or is left to the default.
  const { share, base } = await shareOf({ artifact: "lantern" });
  expect(share).toMatchObject({ scope: { kind: "artifact", name: "lantern", title: "lantern" }, comments: false, state: "active" });
  expect(Date.parse(share.expiresAt) - Date.now()).toBeGreaterThan(50 * 365 * 24 * 3600_000);
  expect(share.url).toStartWith(`https://${HOST}/s/`);
  expect(share.url).not.toContain(origin);

  const page = await outsider(`${base}/`);
  expect(page.status).toBe(200);
  const text = await page.text();
  const [frame] = frames(text);
  expect(frames(text)).toHaveLength(1);
  expect(await (await fetch(frame!)).text()).toContain("Lantern");
  expect(text).not.toContain("Field notes");
  // No notes, no search, nothing but the artifact; and not another artifact by editing the frame's address.
  for (const path of [`${base}/p/${hub.id}`, `${base}/index.json`, `${base}/search`, `${base}/p/${survey.id}/artifact/1`]) expect((await outsider(path)).status).toBe(404);
  expect((await fetch(frame!.replace("/lantern/", "/moth-site/"))).status).toBe(401);
  expect((await fetch(frame!.replace(/\/s\/_\/[0-9a-f]{8}/, "/s/_/00000000"))).status).toBe(401);
  // It is on the list of what is shared, with a revoke, like any share.
  const { shares } = await client.request<{ shares: ShareSession[] }>({ action: "shares.list" });
  expect(shares.find(row => row.id === share.id)?.scope).toMatchObject({ kind: "artifact", name: "lantern" });
  const listed = await (await owner("/shares")).text();
  expect(listed).toContain("the artifact");
  expect(listed).toContain("never (until revoked)");
  await client.request({ action: "shares.revoke", shareId: share.id });
});

test("a share of a page opens the artifacts that page frames, scoped to the share, and no others", async () => {
  const { base, share } = await shareOf({ scope: hub.id, ttl: "1h" });
  expect(Date.parse(share.expiresAt) - Date.parse(share.createdAt)).toBe(3_600_000);
  const page = await (await outsider(`${base}/p/${survey.id}`)).text();
  const [frame] = frames(page);
  expect(frames(page)).toHaveLength(1);
  expect(await (await fetch(frame!)).text()).toContain("Moth site");
  expect(page.split(origin).length - 1).toBe(1);
  expect(page).toContain(`href="${base}/p/${survey.id}/artifact/1"`);
  const alone = await outsider(`${base}/p/${survey.id}/artifact/1`);
  expect(alone.status).toBe(200);
  expect(frames(await alone.text())).toHaveLength(1);
  // Not an artifact of a note outside the share, nor of a locked note inside it; not by editing the frame either.
  expect((await outsider(`${base}/p/${elsewhere.id}/artifact/1`)).status).toBe(404);
  expect((await outsider(`${base}/p/${locked.id}/artifact/1`)).status).toBe(404);
  for (const other of ["lantern", "vault"]) expect((await fetch(frame!.replace("/moth-site/", `/${other}/`))).status).toBe(401);
  // The artifact's own address is the owner's: a share has no /a/ page.
  expect((await outsider(`${base}/a/moth-site/`)).status).toBe(404);
  // Every link in the page stays below the share.
  for (const href of [...page.matchAll(/href="([^"]*)"/g)].map(match => match[1]!.replace(/&amp;/g, "&"))) expect(href).toStartWith(`${base}/`);
  await client.request({ action: "shares.revoke", shareId: share.id });
});

test("revoking a share closes the page and everything it framed, and its frames answer that it ended", async () => {
  const page = await shareOf({ scope: hub.id });
  const lone = await shareOf({ artifact: "lantern" });
  const framed = frames(await (await outsider(`${page.base}/p/${survey.id}`)).text())[0]!;
  const alone = frames(await (await outsider(`${lone.base}/`)).text())[0]!;
  expect((await fetch(framed)).status).toBe(200);
  expect((await fetch(alone)).status).toBe(200);

  await client.request({ action: "shares.revoke", shareId: page.share.id });
  expect((await outsider(`${page.base}/p/${survey.id}`)).status).toBe(410);
  expect((await fetch(framed)).status).toBe(410);
  // The other share is its own: ending one leaves the other open.
  expect((await fetch(alone)).status).toBe(200);

  await client.request({ action: "shares.revoke", shareId: lone.share.id });
  expect((await outsider(`${lone.base}/`)).status).toBe(410);
  const ended = await fetch(alone);
  expect(ended.status).toBe(410);
  expect(await ended.text()).not.toContain("Lantern");
  // A share that ran out by the clock closes its page and its frames as a revoked one does, with nothing revoked.
  const short = await shareOf({ scope: hub.id });
  const shortFrame = frames(await (await outsider(`${short.base}/p/${survey.id}`)).text())[0]!;
  expect((await fetch(shortFrame)).status).toBe(200);
  const kept = JSON.parse(store.readMetadata(SHARES_METADATA_KEY)!);
  kept.sessions.find((row: ShareSession) => row.id === short.share.id).expiresAt = new Date(Date.now() - 1000).toISOString();
  store.writeMetadata(SHARES_METADATA_KEY, JSON.stringify(kept));
  expect((await outsider(`${short.base}/p/${survey.id}`)).status).toBe(410);
  expect((await fetch(shortFrame)).status).toBe(410);
  await client.request({ action: "shares.revoke", all: true });
});

test("a HEAD request or a link preview opens nothing and uses nothing up: the link works afterwards", async () => {
  const { base, share } = await shareOf({ artifact: "lantern" });
  const frame = frames(await (await outsider(`${base}/`)).text())[0]!;
  // Over real HTTP, as a chat app's link preview meets it.
  const listener = Bun.serve({ port: 0, fetch: request => publisher.handle(new Request(`https://${HOST}${new URL(request.url).pathname}`, { method: request.method, headers: { host: HOST, ...html } }), "public") });
  try {
  for (let preview = 0; preview < 3; preview++) {
    const head = await fetch(`${listener.url.origin}${base}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const frameHead = await fetch(frame, { method: "HEAD" });
    expect(frameHead.status).toBe(200);
    expect(await frameHead.text()).toBe("");
  }
  expect((await fetch(frame)).status).toBe(200);
  expect((await outsider(`${base}/`)).status).toBe(200);
  // Only writes are refused, whoever sends them.
  expect((await outsider(`${base}/`, "POST")).status).toBe(405);
  expect((await fetch(frame, { method: "POST" })).status).toBe(405);
  } finally { listener.stop(true); }
  await client.request({ action: "shares.revoke", shareId: share.id });
});

test("a published page without a share frames nothing: an outsider gets the card, not the artifact", async () => {
  const page = await outsider(`/share/p/${published.id}`);
  expect(page.status).toBe(200);
  const text = await page.text();
  expect(frames(text)).toHaveLength(0);
  expect(text).not.toContain(origin);
  expect((await outsider(`/share/p/${published.id}/artifact/1`)).status).toBe(404);
});

test("on the outline host, a named outline's share is found by the artifact host through the host's own socket", async () => {
  // The production pairing: grants carry the outline's name, and the artifact host asks the host (not one outline's socket).
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "outliner-artifact-host-")));
  const layout = outlineLayout(join(folder, "outlines"));
  new OutlinerStore(layout.database("orchard"), { workspaceRoot: folder }).close();
  const outlineHost = new OutlineHost({ outlinesFolder: layout.root, log: () => {} });
  await outlineHost.start();
  const orchard = new OutlinerClient(layout.socket, 15_000, "orchard");
  const listener = Bun.serve({ port: 0, fetch: request => artifactResponse(join(layout.root, ".artifacts"), request, "'self'", { shareOpen: sharesFromSocket(layout.socket) }) });
  const keep = process.env.EP0CH_ARTIFACT_ORIGIN;
  process.env.EP0CH_ARTIFACT_ORIGIN = listener.url.origin;
  try {
    await new OutlinerClient(layout.socket, 15_000).request({ action: "artifacts.put", name: "pears", files: { "index.html": "<h1>Pears</h1>" } });
    const { share } = await orchard.request<{ share: ShareSession }>({ action: "shares.start", artifact: "pears" });
    const info = await orchard.request<ArtifactInfo>({ action: "artifacts.show", name: "pears", frame: { share: { id: share.id } } });
    expect(info.frame).toContain("/s/orchard/");
    expect(await (await fetch(info.frame!)).text()).toContain("Pears");
    // Another outline's share of the same id means nothing here: the grant names its outline.
    expect((await fetch(info.frame!.replace("/s/orchard/", "/s/_/"))).status).toBe(401);
    await orchard.request({ action: "shares.revoke", shareId: share.id });
    expect((await fetch(info.frame!)).status).toBe(410);
  } finally {
    if (keep === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = keep;
    listener.stop(true);
    await outlineHost.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
