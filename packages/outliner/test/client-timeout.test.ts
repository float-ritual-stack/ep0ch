// PIE-1597: a batch reader can wait where a keypress should not. EP0CH_REQUEST_TIMEOUT_MS is read by the outliner CLI and
// handed to its client; an interactive client never reads it. Nobody answers on the socket, so each test only waits.
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

test("a client's wait is what its caller says, and a request's own wait still wins", async () => {
  const client = createOutlinerClient({ socket, mode: "host", outline: "garden" }, { timeoutMs: 40 });
  expect(waited(await client.request({ action: "blocks.query", query: {} } as never).catch(e => e))).toBe(40);
  expect(waited(await client.request({ action: "blocks.query", query: {} } as never, 15).catch(e => e))).toBe(15);
});

test("the environment never reaches an interactive client: a Tree's keypress keeps its own wait", async () => {
  const before = process.env.EP0CH_REQUEST_TIMEOUT_MS;
  process.env.EP0CH_REQUEST_TIMEOUT_MS = "40";
  try {
    const client = createOutlinerClient({ socket, mode: "host", outline: "garden" });
    const asked = client.request({ action: "blocks.query", query: {} } as never, undefined).catch(e => e);
    const first = await Promise.race([asked, Bun.sleep(300).then(() => "still waiting")]);
    expect(first).toBe("still waiting");
    expect(waited(await asked)).toBe(3000);
  } finally {
    if (before === undefined) delete process.env.EP0CH_REQUEST_TIMEOUT_MS; else process.env.EP0CH_REQUEST_TIMEOUT_MS = before;
  }
}, 10_000);

test("the outliner CLI, a batch reader's entry, does read the environment", async () => {
  const cli = Bun.spawn(["bun", "src/cli.ts", "list"], {
    cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env.PATH!, HOME: folder, EP0CH_OUTLINES: folder, EP0CH_SOCKET: socket, EP0CH_WS: "garden", EP0CH_REQUEST_TIMEOUT_MS: "120" },
  });
  const [err, code] = await Promise.all([new Response(cli.stderr).text(), cli.exited]);
  expect(code).not.toBe(0);
  expect(err).toContain("timed out after 120ms");
}, 20_000);

test("the reader takes a positive number of milliseconds, else leaves the client's default", () => {
  expect(requestTimeoutMs({ EP0CH_REQUEST_TIMEOUT_MS: "60000" })).toBe(60_000);
  for (const value of [undefined, "", "soon", "0", "-5"]) expect(requestTimeoutMs({ EP0CH_REQUEST_TIMEOUT_MS: value })).toBeUndefined();
});

test("a connection closed before its answer fails then, not at the timeout (PIE-1779)", async () => {
  // float-2, Nov 12: an SSH forward ended under the followers' reads closed their connections without an answer; each
  // waited out its 15 s and said "timed out", hiding the reset behind it.
  const { scratchDir } = await import("./scratch-outline");
  const dir = scratchDir("outliner-closed-");
  const closing = createServer(c => c.once("data", () => c.end()));
  const path = join(dir, "closing.sock");
  await new Promise<void>(resolve => closing.listen(path, resolve));
  try {
    const client = createOutlinerClient({ socket: path, mode: "host", outline: "garden" }, { timeoutMs: 5_000 });
    const started = Date.now();
    const error: Error = await client.request({ action: "blocks.query", query: {} } as never).then(() => new Error("answered"), (e: Error) => e);
    expect({ timedOut: error instanceof OutlinerTimeoutError, message: error.message }).toEqual({ timedOut: false, message: expect.stringContaining("closed the connection before it answered") });
    expect(Date.now() - started).toBeLessThan(2_000);
  } finally { closing.close(); rmSync(dir, { recursive: true, force: true }); }
});
