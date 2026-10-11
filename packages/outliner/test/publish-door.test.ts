import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { WebDoor } from "../src/publish-door";
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

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-door-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const paths = scratchOutline(root, { folder: root });
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket);
  const door = new WebDoor({ ptyzzz: fakePtyzzz(), command: open => ["ep0ch", "--ws", "garden", ...(open ? ["--screen", "detail", open] : [])], graceMs: 50 });
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

test("the door is never served on the public listener, below a share link, or at the signed-in origin", async () => {
  const { publisher, client, note } = await setup();
  const pub = (path: string) => publisher.handle(new Request(`https://garden.example.test${path}`), "public");
  expect((await pub("/share/door")).status).toBe(404);
  expect((await pub(`/share/door?open=${note.id}`)).status).toBe(404);
  expect((await pub("/share/door/stream?t=abcdefabcdefabcdef01")).status).toBe(404);
  const { share } = await client.request<{ share: ShareSession }>({ action: "shares.start", scope: note.id });
  const shared = new URL(share.url!).pathname.match(/^.*\/s\/[^/]+/)![0];
  expect((await pub(`${shared}/p/${note.id}`)).status).toBe(200);
  expect(await (await pub(`${shared}/p/${note.id}`)).text()).not.toContain("/door");
  expect((await pub(`${shared}/door`)).status).toBe(404);
  expect((await pub(`${shared}/door/stream?t=abcdefabcdefabcdef01`)).status).toBe(404);
  const signedIn = { sessionId: "web-1", subject: "user_moth" } as unknown as Parameters<Publisher["handle"]>[3];
  expect((await publisher.handle(new Request("https://my.garden.example.test/pub/door"), "tailnet", undefined, signedIn)).status).toBe(404);
  await client.request({ action: "shares.revoke", shareId: share.id });
});

test("a page's terminal runs the door attached to the outline, streams its frames and takes its keys", async () => {
  const { publisher, note } = await setup();
  const t = "fernfernfernfern01";
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
  const stats = await (await tailnet(publisher, "/pub/door/stats")).json() as Array<{ inputs: number }>;
  expect(stats[0]!.inputs).toBe(1);
});

test("another site can't open a terminal or type into one", async () => {
  const { publisher } = await setup();
  const t = "fernfernfernfern02";
  expect((await tailnet(publisher, `/pub/door/stream?t=${t}`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  const stream = await tailnet(publisher, `/pub/door/stream?t=${t}`);
  const typed = await tailnet(publisher, `/pub/door/input?t=${t}`, { method: "POST", headers: { origin: "https://evil.example" }, body: '{"t":"input","b":"x"}\n' });
  expect(typed.status).toBe(403);
  await stream.body!.cancel();
  // A terminal id that names none, or isn't one, gets nothing.
  expect((await tailnet(publisher, "/pub/door/input?t=short", { method: "POST", headers: { origin: "http://moth-box.tail0000.ts.net" }, body: "{}" })).status).toBe(404);
});
