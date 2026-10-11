import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { WebDoor } from "../src/publish-door";
import { SESSION_COOKIE, SignInGate } from "../src/web-signin";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A stand-in for ptyZZZ: says a keyframe, then answers each command line with a diff naming it, as the real one answers
 * keys with frames. What runs in the pty (the door) is its argv, said in the keyframe.
 */
function fakePtyzzz(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "web-door-")));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "target", "release"), { recursive: true });
  const bin = join(dir, "target", "release", "ptyZZZ");
  writeFileSync(bin, `#!/usr/bin/env bun
const argv = JSON.stringify(process.argv.slice(2).join(" ")).slice(1, -1);
console.log('{"cols":80,"html":"<div id=\\\\"grid-door\\\\">' + argv + ' EP0CH_KITTY=' + process.env.EP0CH_KITTY + '</div>","rows":24,"seqno":1,"t":"screen"}');
let n = 1;
for await (const line of console) { n++; console.log(JSON.stringify({ base: n - 1, patch: line, seqno: n, t: "diff" })); }
`);
  chmodSync(bin, 0o755);
  return dir;
}

async function setup(doorOptions: { recheckMs?: number } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-door-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const paths = scratchOutline(root, { folder: root });
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket);
  const door = new WebDoor({ ptyzzz: fakePtyzzz(), command: open => ["ep0ch", "--ws", "garden", ...(open ? ["--screen", "detail", open] : [])], graceMs: 50, ...doorOptions });
  const publisher = new Publisher({ client, basePath: "/pub", publicUrl: "https://garden.example.test/share", door });
  cleanups.push(async () => {
    await publisher.stop();
    await server.close();
    store.close();
  });
  await publisher.start();
  const note = store.create("Moth log [publish::true]\nThe hawk-moths came at dusk.");
  return { store, client, publisher, note };
}

/** The terminal id a door page was given. */
async function issued(publisher: Publisher, query = ""): Promise<string> {
  const html = await (await tailnet(publisher, `/pub/door${query}`)).text();
  return html.match(/data-t="([^"]+)"/)![1]!;
}

const tailnet = (publisher: Publisher, path: string, init: RequestInit = {}) =>
  publisher.handle(new Request(`http://moth-box.tail0000.ts.net${path}`, init), "tailnet");

/** One SSE stream's `data:` lines as they come, until `until` says enough. */
async function frames(response: Response, until: (seen: string[]) => boolean): Promise<string[]> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const seen: string[] = [];
  let buffered = "";
  while (!until(seen)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    for (const block of buffered.split("\n\n").slice(0, -1)) if (block.startsWith("data: ")) seen.push(block.slice(6));
    buffered = buffered.slice(buffered.lastIndexOf("\n\n") + 2);
  }
  await reader.cancel();
  return seen;
}

test("a tailnet note's page links its door, and the door page runs only its own scripts", async () => {
  const { publisher, note } = await setup();
  const page = await (await tailnet(publisher, `/pub/p/${note.id}`, { headers: { accept: "text/html" } })).text();
  expect(page).toContain(`<a href="/pub/door?open=${note.id}">door</a>`);
  const door = await tailnet(publisher, `/pub/door?open=${note.id}`);
  expect(door.status).toBe(200);
  expect(door.headers.get("content-security-policy")).toContain("script-src 'self'");
  const html = await door.text();
  expect(html).toContain(`data-open="${note.id}"`);
  expect(html).toContain(`src="/pub/door/door.js"`);
  expect((await tailnet(publisher, "/pub/door/client.js")).status).toBe(200);
});

const MY = "https://my.garden.example.test";
const PERSON = "user_fictional0001";

/**
 * The signed-in listener's gate in front of the publisher (web-signin.ts, as `publish serve --signin-port` wires it),
 * with the host's web sessions stood in: two live sessions by their cookie tokens, which `end` ends.
 */
function signedInGate(publisher: Publisher) {
  const sessions = new Map([["moth-token-aaaaaaaa", { id: "web-moth", subject: PERSON }], ["fern-token-bbbbbbbb", { id: "web-fern", subject: PERSON }]]);
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const wire = (s: { id: string; subject: string }) => ({ ...s, device: "test", createdAt: expiresAt, lastSeenAt: expiresAt, expiresAt });
  const gate = new SignInGate({
    settings: { origin: MY, issuer: "https://clerk.example.test", clientId: "fictional", allowedSubjects: [PERSON], home: "/pub/" },
    request: async <T,>(input: Record<string, unknown>) => {
      if (input.action === "web.sessions.resolve") {
        const s = sessions.get(String(input.token));
        return { found: s ? { session: wire(s), renewed: false } : null } as T;
      }
      if (input.action === "web.sessions.list") return { sessions: [...sessions.values()].map(wire) } as T;
      throw new Error(`unexpected ${String(input.action)}`);
    },
    serve: (request, signedIn) => publisher.handle(request, "tailnet", undefined, signedIn),
  });
  const at = (path: string, token?: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) =>
    gate.handle(new Request(`${MY}${path}`, { ...init, headers: { host: "my.garden.example.test", accept: "text/html", ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}), ...init.headers } }));
  return { at, end: (token: string) => sessions.delete(token) };
}

const termOf = async (response: Response) => (await response.text()).match(/data-t="([^"]+)"/)![1]!;
const SSE = { headers: { accept: "text/event-stream" } };

test("the door is served on the tailnet and signed in, never on the public listener or below a share link", async () => {
  const { publisher, client, note } = await setup();
  // The tailnet listener.
  expect((await tailnet(publisher, `/pub/door?open=${note.id}`)).status).toBe(200);
  // The signed-in listener, for a live web session: the same page, and its note's footer links it.
  const { at } = signedInGate(publisher);
  const signed = await at(`/pub/door?open=${note.id}`, "moth-token-aaaaaaaa");
  expect(signed.status).toBe(200);
  expect(await signed.text()).toContain(`data-open="${note.id}"`);
  expect(await (await at(`/pub/p/${note.id}`, "moth-token-aaaaaaaa")).text()).toContain(`<a href="/pub/door?open=${note.id}">door</a>`);
  // The public listener.
  const pub = (path: string) => publisher.handle(new Request(`https://garden.example.test${path}`), "public");
  expect((await pub("/share/door")).status).toBe(404);
  expect((await pub(`/share/door?open=${note.id}`)).status).toBe(404);
  expect((await pub("/share/door/stream?t=abcdefabcdefabcdef01")).status).toBe(404);
  // Below a share link.
  const { share } = await client.request<{ share: ShareSession }>({ action: "shares.start", scope: note.id });
  const shared = new URL(share.url!).pathname.match(/^.*\/s\/[^/]+/)![0];
  expect((await pub(`${shared}/p/${note.id}`)).status).toBe(200);
  expect(await (await pub(`${shared}/p/${note.id}`)).text()).not.toContain("/door");
  expect((await pub(`${shared}/door`)).status).toBe(404);
  expect((await pub(`${shared}/door/stream?t=abcdefabcdefabcdef01`)).status).toBe(404);
  await client.request({ action: "shares.revoke", shareId: share.id });
});

test("signed out, the door is the sign-in page, coming back to it; a stream or a key gets nothing", async () => {
  const { publisher, note } = await setup();
  const { at } = signedInGate(publisher);
  const out = await at(`/pub/door?open=${note.id}`);
  expect(out.status).toBe(401);
  const html = await out.text();
  expect(html).toContain(`/signin/start?next=${encodeURIComponent(`/pub/door?open=${note.id}`)}`);
  expect(html).not.toContain("data-t=");
  // A terminal id a tailnet page was given opens no stream and takes no keys signed out, or with a dead cookie.
  const t = await issued(publisher);
  expect((await at(`/pub/door/stream?t=${t}`, undefined, SSE)).status).toBe(401);
  expect((await at(`/pub/door/input?t=${t}`, undefined, { method: "POST", headers: { origin: MY }, body: '{"t":"key","key":"i","mods":0}\n' })).status).toBe(401);
  expect((await at(`/pub/door/input?t=${t}`, "gone-token-cccccccc", { method: "POST", headers: { origin: MY }, body: "{}" })).status).toBe(401);
});

test("signed in, a terminal is its own session's: another session, the tailnet or another site can't use its id", async () => {
  const { publisher } = await setup();
  const { at } = signedInGate(publisher);
  // An id issued to one web session starts nothing for another, nor for the tailnet; a tailnet page's id, nothing signed in.
  const mine = await termOf(await at("/pub/door", "moth-token-aaaaaaaa"));
  expect((await at(`/pub/door/stream?t=${mine}`, "fern-token-bbbbbbbb", SSE)).status).toBe(404);
  expect((await tailnet(publisher, `/pub/door/stream?t=${mine}`)).status).toBe(404);
  expect((await at(`/pub/door/stream?t=${await issued(publisher)}`, "moth-token-aaaaaaaa", SSE)).status).toBe(404);
  // A cross-site request is refused, cookie or not.
  const fresh = await termOf(await at("/pub/door", "moth-token-aaaaaaaa"));
  expect((await at(`/pub/door/stream?t=${fresh}`, "moth-token-aaaaaaaa", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  // Its own session streams it. Keys reach it from this origin and session only.
  const stream = await at(`/pub/door/stream?t=${fresh}`, "moth-token-aaaaaaaa", SSE);
  expect(stream.headers.get("content-type")).toBe("text/event-stream");
  const key = (k: string) => `{"t":"key","key":"${k}","mods":0}\n`;
  expect((await at(`/pub/door/input?t=${fresh}`, "moth-token-aaaaaaaa", { method: "POST", headers: { origin: "https://evil.example" }, body: key("x") })).status).toBe(403);
  expect((await at(`/pub/door/input?t=${fresh}`, "fern-token-bbbbbbbb", { method: "POST", headers: { origin: MY }, body: key("x") })).status).toBe(404);
  expect((await tailnet(publisher, `/pub/door/input?t=${fresh}`, { method: "POST", headers: { origin: "http://moth-box.tail0000.ts.net" }, body: key("x") })).status).toBe(404);
  const sent = at(`/pub/door/input?t=${fresh}`, "moth-token-aaaaaaaa", { method: "POST", headers: { origin: MY }, body: key("i") });
  const seen = await frames(stream, s => s.some(line => line.includes('"t":"diff"') && line.includes('\\"key\\"')));
  expect((await sent).status).toBe(204);
  const patches = seen.filter(line => line.includes('"t":"diff"')).map(line => JSON.parse(JSON.parse(line).patch));
  expect(patches).toEqual([{ t: "screen" }, { t: "key", key: "i", mods: 0 }]);
});

test("a signed-in stream ends when its web session does", async () => {
  const { publisher } = await setup({ recheckMs: 30 });
  const { at, end } = signedInGate(publisher);
  const t = await termOf(await at("/pub/door", "moth-token-aaaaaaaa"));
  const stream = await at(`/pub/door/stream?t=${t}`, "moth-token-aaaaaaaa", SSE);
  const reader = stream.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  end("moth-token-aaaaaaaa");
  // Revoked (or signed out, or expired): the stream closes within a recheck, and reconnecting gets the sign-in.
  const closed = await Promise.race([(async () => { while (!(await reader.read()).done); return true; })(), Bun.sleep(2000).then(() => false)]);
  expect(closed).toBe(true);
  expect((await at(`/pub/door/stream?t=${t}`, "moth-token-aaaaaaaa", SSE)).status).toBe(401);
});

test("a page's terminal runs the door attached to the outline, streams its frames and takes its keys", async () => {
  const { publisher, note } = await setup();
  const t = await issued(publisher, `?open=${note.id}`);
  const stream = await tailnet(publisher, `/pub/door/stream?t=${t}&cols=100&rows=30&open=${note.id}`);
  expect(stream.headers.get("content-type")).toBe("text/event-stream");
  const sent = tailnet(publisher, `/pub/door/input?t=${t}`, { method: "POST", headers: { origin: "http://moth-box.tail0000.ts.net" }, body: '{"t":"key","key":"i","mods":0}\nnot json\n' });
  const keyed = (line: string) => line.includes('"t":"diff"') && line.includes('\\"key\\"');
  const seen = await frames(stream, s => s.some(keyed));
  expect((await sent).status).toBe(204);
  // The door, with no Kitty graphics, at the page's size, opening the note in its detail screen.
  expect(seen[0]).toContain(`--cols 100 --rows 30 -- ep0ch --ws garden --screen detail ${note.id} EP0CH_KITTY=0`);
  // A joiner asks for a fresh keyframe; then only the JSON command passed to the terminal, never the line that isn't.
  const patches = seen.filter(line => line.includes('"t":"diff"')).map(line => JSON.parse(JSON.parse(line).patch));
  expect(patches).toEqual([{ t: "screen" }, { t: "key", key: "i", mods: 0 }]);
  const stats = await (await tailnet(publisher, "/pub/door/stats")).json() as Array<{ inputs: number; pid: number }>;
  expect(stats[0]!.inputs).toBe(1);
  // The publisher stopping ends the terminal even while a page watches it.
  await publisher.stop();
  expect(() => process.kill(stats[0]!.pid, 0)).toThrow();
});

test("another site can't open a terminal or type into one", async () => {
  const { publisher } = await setup();
  // An id the page wasn't given (one another site picks) starts nothing.
  expect((await tailnet(publisher, "/pub/door/stream?t=fernfernfernfern02")).status).toBe(404);
  const t = await issued(publisher);
  expect((await tailnet(publisher, `/pub/door/stream?t=${t}`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  const stream = await tailnet(publisher, `/pub/door/stream?t=${t}`);
  const typed = await tailnet(publisher, `/pub/door/input?t=${t}`, { method: "POST", headers: { origin: "https://evil.example" }, body: '{"t":"input","b":"x"}\n' });
  expect(typed.status).toBe(403);
  await stream.body!.cancel();
  // A terminal id that names none, or isn't one, gets nothing.
  expect((await tailnet(publisher, "/pub/door/input?t=short", { method: "POST", headers: { origin: "http://moth-box.tail0000.ts.net" }, body: "{}" })).status).toBe(404);
});
