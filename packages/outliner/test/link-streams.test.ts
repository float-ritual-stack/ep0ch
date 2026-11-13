// PIE-1779: the link carried one chunk per stream per round trip. float-2, Nov 12: a laptop's change-log page came
// over it at about 30 KB/s (a 25 s read of a 7 MB outline's first page got 761 KB) while ssh carried 650 KB/s, so the
// followers of the laptop's big outlines timed out on their first page. Here the two ends talk over a line of their own:
// a delay each way, a rate, and a send buffer that holds what waits to go out, as a WebSocket's does (and the link
// closes past 4 MB of it). The far end's host answers `<n>\n` with n bytes.
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { LinkStreams } from "../src/link-streams";
import { scratchDir } from "./scratch-outline";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });

const WEBSOCKET_LIMIT = 4 * 1024 * 1024;
/** The bytes `n` asks the host for: the same every time, so a digest says they all arrived in order. */
const bytesOf = (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 9)) & 255; return b; };
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** One direction of the line: frames go out in order at `rate` bytes a second, then take `ms` to arrive. */
function line(o: { ms: number; rate: number }) {
  const fifo: Buffer[] = [];
  let buffered = 0, most = 0, stalled = false, sending = false, to: (b: Buffer) => void = () => {};
  const next = () => {
    if (sending || stalled || !fifo.length) return;
    const b = fifo.shift()!;
    sending = true;
    setTimeout(() => { buffered -= b.length; sending = false; setTimeout(() => to(b), o.ms); next(); }, (b.length / o.rate) * 1000);
  };
  return {
    send(b: Buffer) { fifo.push(b); buffered += b.length; most = Math.max(most, buffered); next(); },
    buffered: () => buffered, most: () => most,
    stall(on: boolean) { stalled = on; next(); },
    to(f: (b: Buffer) => void) { to = f; },
  };
}

/** A connector whose host answers `<n>\n` with n bytes, and the server's end, over a line each way. */
async function linked(o: { ms?: number; rate?: number } = {}) {
  const dir = scratchDir("link-streams-");
  const hostSock = join(dir, "host.sock"), linkSock = join(dir, "link.sock");
  // Half open: a host may still write after the link ends its side (a reply already on its way).
  const host = createServer({ allowHalfOpen: true }, socket => {
    let asked = "";
    socket.on("error", () => {});
    socket.on("data", (d: Buffer) => {
      asked += d.toString();
      if (!asked.includes("\n")) return;
      // `late <n>`: a first part now, the rest after the asker may have hung up (a reply still coming when it does).
      if (asked.startsWith("late ")) { socket.write(bytesOf(64 * 1024)); setTimeout(() => { if (!socket.destroyed) socket.end(bytesOf(Number(asked.slice(5).trim()))); }, 400); }
      else socket.end(bytesOf(Number(asked.trim())));
    });
  });
  await new Promise<void>(resolve => host.listen(hostSock, resolve));
  const up = line({ ms: o.ms ?? 100, rate: o.rate ?? 20e6 }), down = line({ ms: o.ms ?? 100, rate: o.rate ?? 20e6 });
  const connector = new LinkStreams(b => up.send(b), hostSock, { buffered: up.buffered });
  const server = new LinkStreams(b => down.send(b), undefined, { buffered: down.buffered });
  up.to(b => server.receive(b)); down.to(b => connector.receive(b));
  const listener: Server = createServer(socket => server.open(socket));
  await new Promise<void>(resolve => listener.listen(linkSock, resolve));
  cleanups.push(() => { connector.close(); server.close(); listener.close(); host.close(); rmSync(dir, { recursive: true, force: true }); });
  /** Asks for n bytes over the link: what came back, and when; it hangs up once `cancelAfter` bytes came, or at `hangUpMs`. */
  const read = (n: number | string, cancelAfter?: number, hangUpMs?: number) => new Promise<{ digest: string; bytes: number; ms: number }>((resolve, reject) => {
    const started = Date.now(), parts: Buffer[] = [];
    let bytes = 0;
    const c: Socket = createConnection(linkSock, () => c.write(`${n}\n`));
    if (hangUpMs !== undefined) setTimeout(() => c.destroy(), hangUpMs);
    c.on("data", (d: Buffer) => { parts.push(d); bytes += d.length; if (cancelAfter !== undefined && bytes >= cancelAfter) c.destroy(); });
    c.on("error", reject);
    c.on("close", () => resolve({ digest: digest(Buffer.concat(parts)), bytes, ms: Date.now() - started }));
  });
  return { read, up, connector, server };
}

test("a stream keeps chunks in flight across a slow line, so a page arrives at the line's speed, not one chunk a round trip", async () => {
  const { read } = await linked();
  const got = await read(4 * 1024 * 1024);
  expect(got.digest).toBe(digest(bytesOf(4 * 1024 * 1024)));
  // One 64 KB chunk a 200 ms round trip: 13 s. A window of chunks: a few round trips.
  expect(got.ms).toBeLessThan(3_000);
}, 30_000);

test("many streams at once arrive whole, and the send buffer never reaches the WebSocket's 4 MB", async () => {
  const { read, up } = await linked();
  const all = await Promise.all(Array.from({ length: 8 }, () => read(2 * 1024 * 1024)));
  expect(all.map(r => r.digest)).toEqual(Array(8).fill(digest(bytesOf(2 * 1024 * 1024))));
  expect(up.most()).toBeLessThan(WEBSOCKET_LIMIT);
}, 60_000);

test("reads hung up part way leave the link free: nothing stays charged, and a short answer after them comes at once (Codex on #1484)", async () => {
  const { read, connector, server } = await linked();
  // Each hangs up after the first part; the rest of each reply comes after the hang-up has crossed.
  const cancelled = await Promise.all(Array.from({ length: 8 }, () => read("late 1048576", 64 * 1024)));
  expect(cancelled.every(r => r.bytes < 1024 * 1024)).toBe(true);
  // Once the hang-ups have crossed (a round trip and the frames in flight), neither end holds a stream or a credit.
  await Bun.sleep(1_500);
  expect({ connector: connector.held(), server: server.held() }).toEqual({ connector: { streams: 0, inFlight: 0 }, server: { streams: 0, inFlight: 0 } });
  const reply = await Promise.race([read(5), Bun.sleep(3_000).then(() => null)]);
  expect(reply?.digest).toBe(digest(bytesOf(5)));
}, 30_000);

test("a stalled line with reads hung up meanwhile never buffers past the WebSocket's 4 MB, and the rest arrive whole (Codex on #1484)", async () => {
  const { read, up } = await linked({ rate: 8e6 });
  const kept = Array.from({ length: 6 }, () => read(4 * 1024 * 1024));
  const hungUp = Array.from({ length: 6 }, () => read(4 * 1024 * 1024, undefined, 600));
  // Everything asked and flowing; then the line out of the laptop stalls with frames in its buffer, and half the
  // askers hang up: the far end hears it over the other direction, which still flows.
  await Bun.sleep(300);
  up.stall(true);
  await Promise.all(hungUp);
  await Bun.sleep(1_500);
  up.stall(false);
  const done = await Promise.all(kept);
  expect(done.map(r => r.digest)).toEqual(Array(6).fill(digest(bytesOf(4 * 1024 * 1024))));
  expect(up.most()).toBeLessThan(WEBSOCKET_LIMIT);
}, 60_000);

test("a short answer isn't held behind bulk transfers: each waiting stream gets its turn (Codex on #1484)", async () => {
  const { read } = await linked({ rate: 4e6 });
  const bulk = Array.from({ length: 4 }, () => read(8 * 1024 * 1024));
  await Bun.sleep(500);
  const reply = await read(5);
  expect(reply.digest).toBe(digest(bytesOf(5)));
  expect(reply.ms).toBeLessThan(1_000);
  await Promise.all(bulk);
}, 60_000);
