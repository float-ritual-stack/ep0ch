// PIE-1779: the link carried one chunk per stream per round trip. float-2, Nov 12: a laptop's change-log page came
// over it at about 30 KB/s (a 25 s read of a 7 MB outline's first page got 761 KB) while ssh carried 650 KB/s, so the
// followers of the laptop's big outlines timed out on their first page. Here the two ends talk through a line that
// takes 100 ms each way; the far end's host sends a few megabytes.
import { afterEach, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { createConnection, createServer, type Server } from "node:net";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { LinkStreams } from "../src/link-streams";
import { DATA, readFrame } from "../src/link-frame";
import { scratchDir } from "./scratch-outline";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });

/** A connector whose host sends `payload` to every connection, and a server's end, over a line `ms` long each way. */
async function linked(payload: Buffer, ms = 100) {
  const dir = scratchDir("link-streams-");
  const hostSock = join(dir, "host.sock"), linkSock = join(dir, "link.sock");
  const host = createServer(socket => { socket.on("error", () => {}); socket.end(payload); });
  await new Promise<void>(resolve => host.listen(hostSock, resolve));
  // What the connector has sent that the server hasn't had yet: the WebSocket's buffer, as far as the line goes.
  let inTransit = 0, mostInTransit = 0;
  let server!: LinkStreams;
  const connector = new LinkStreams(bytes => {
    if (readFrame(bytes).op === DATA) { inTransit += bytes.length; mostInTransit = Math.max(mostInTransit, inTransit); }
    setTimeout(() => { if (readFrame(bytes).op === DATA) inTransit -= bytes.length; server.receive(bytes); }, ms);
  }, hostSock);
  server = new LinkStreams(bytes => setTimeout(() => connector.receive(bytes), ms));
  const listener: Server = createServer(socket => server.open(socket));
  await new Promise<void>(resolve => listener.listen(linkSock, resolve));
  cleanups.push(() => { connector.close(); server.close(); listener.close(); host.close(); rmSync(dir, { recursive: true, force: true }); });
  const read = () => new Promise<{ digest: string; bytes: number; ms: number }>((resolve, reject) => {
    const started = Date.now(), hash = createHash("sha256");
    let bytes = 0;
    const c = createConnection(linkSock);
    c.on("data", (d: Buffer) => { hash.update(d); bytes += d.length; });
    c.on("error", reject);
    c.on("close", () => resolve({ digest: hash.digest("hex"), bytes, ms: Date.now() - started }));
  });
  return { read, mostInTransit: () => mostInTransit };
}

test("a stream keeps chunks in flight across a slow line, so a page arrives at the line's speed, not one chunk a round trip", async () => {
  const payload = randomBytes(4 * 1024 * 1024);
  const { read } = await linked(payload);
  const got = await read();
  expect(got.digest).toBe(createHash("sha256").update(payload).digest("hex"));
  // One 64 KB chunk a 200 ms round trip: 13 s. A window of chunks: a few round trips.
  expect(got.ms).toBeLessThan(3_000);
}, 30_000);

test("many streams at once never put more in flight than the WebSocket buffers (4 MB, past which the link closes)", async () => {
  const payload = randomBytes(2 * 1024 * 1024);
  const { read, mostInTransit } = await linked(payload);
  const all = await Promise.all(Array.from({ length: 8 }, () => read()));
  const want = createHash("sha256").update(payload).digest("hex");
  expect(all.map(r => r.digest)).toEqual(Array(8).fill(want));
  expect(mostInTransit()).toBeLessThan(4 * 1024 * 1024);
}, 60_000);
