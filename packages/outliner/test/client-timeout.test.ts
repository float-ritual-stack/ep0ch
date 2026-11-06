// PIE-1597: a batch reader can wait where a keypress should not. EP0CH_REQUEST_TIMEOUT_MS sets a client's wait; a
// request's own wait (a keypress's, a probe's) still wins. Nobody answers on the socket, so each test only waits.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestTimeoutMs } from "@ep0ch/outline-core/request-timeout";
import { createOutlinerClient, OutlinerTimeoutError } from "../src/client";

const folder = mkdtempSync(join(tmpdir(), "outliner-timeout-"));
const socket = join(folder, "silent.sock");
const silent = createServer(() => {});
await new Promise<void>(resolve => silent.listen(socket, resolve));
afterAll(() => { silent.close(); rmSync(folder, { recursive: true, force: true }); });

const waited = (error: unknown) => (error as OutlinerTimeoutError).timeoutMs;

test("EP0CH_REQUEST_TIMEOUT_MS is the client's wait, and a request's own wait still wins", async () => {
  const client = createOutlinerClient({ socket, mode: "host", outline: "garden" }, { EP0CH_REQUEST_TIMEOUT_MS: "40" });
  expect(waited(await client.request({ action: "blocks.query", query: {} } as never).catch(e => e))).toBe(40);
  expect(waited(await client.request({ action: "blocks.query", query: {} } as never, 15).catch(e => e))).toBe(15);
});

test("the reader takes a positive number of milliseconds, else the caller's default", () => {
  expect(requestTimeoutMs({ EP0CH_REQUEST_TIMEOUT_MS: "60000" }, 3000)).toBe(60_000);
  for (const value of [undefined, "", "soon", "0", "-5"]) expect(requestTimeoutMs({ EP0CH_REQUEST_TIMEOUT_MS: value }, 3000)).toBe(3000);
});
