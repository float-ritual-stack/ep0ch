// The parity probes' settle (test/settle.ts): a screen's own read of the host, whichever way it asks, is waited for.
import { afterAll, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostRequest } from "../src/socket";
import { watchHosts } from "./settle";

// A host that answers each line after 300 ms (a loaded runner's outline host).
const dir = mkdtempSync(join(tmpdir(), "ep0ch-settle-")), sock = join(dir, "h.sock");
const server: Server = createServer(c => c.on("data", d => {
  const { id } = JSON.parse(String(d).split("\n")[0]!);
  setTimeout(() => c.write(JSON.stringify({ id, ok: true, result: { outlines: [] } }) + "\n"), 300);
})).listen(sock);
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

test("settle waits for a read through hostRequest (the home base's hostLive), not only SocketBoard's", async () => {
  const w = watchHosts();
  let answered = false;
  // Counted as it's asked, before anything else can run: the count is the process's, and a timer another test file left
  // (a reader's comment read, a lane's refresh) can ask the host while this one waits (a 75-file run did).
  const asked = w.asked();
  void hostRequest(sock, "outlines.list").then(() => { answered = true; });
  expect(w.asked() - asked).toBe(1);
  await w.settle();
  expect(answered).toBe(true);
});

test("settle waits for what else the screen says it's still asking for (the power bar's sources)", async () => {
  let asking = true;
  setTimeout(() => { asking = false; }, 300);
  const w = watchHosts(() => asking);
  const t0 = Date.now();
  await w.settle();
  expect(asking).toBe(false);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
});
