import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { checkServiceCompatibility, waitForCompatibleService } from "../src/service-compatibility";
import { OutlinerStore } from "../src/store";
import type { OutlinerServiceStatus } from "../src/types";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "outliner-protocol-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A service stand-in that answers ping with `status` and records every action. */
async function fakeService(status: Record<string, unknown>): Promise<{ socket: string; actions: string[] }> {
  const socket = join(temporaryDirectory(), "service.sock");
  const actions: string[] = [];
  const server: Server = createServer(connection => {
    let text = "";
    connection.on("data", chunk => {
      text += chunk;
      if (!text.includes("\n")) return;
      const request = JSON.parse(text.slice(0, text.indexOf("\n")));
      actions.push(request.action);
      connection.end(`${JSON.stringify(request.action === "ping"
        ? { id: request.id, ok: true, result: { status: "ready", ...status } }
        : { id: request.id, ok: false, error: `Unknown action: ${request.action}` })}\n`);
    });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  return { socket, actions };
}

test("the service reports this checkout's protocol and nothing else to negotiate", async () => {
  const directory = temporaryDirectory();
  const socket = join(directory, "outliner.sock");
  const store = new OutlinerStore(join(directory, "outliner.sqlite"), { workspaceRoot: directory });
  const server = new OutlinerServer(store, socket);
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); });

  const service = await new OutlinerClient(socket).requireCompatibleService();
  expect(service.protocolVersion).toBe(PROTOCOL);
  for (const gone of ["minClientProtocol", "capabilities", "propertyGrammar", "draftPatchCompare", "searchMatch"]) {
    expect(service).not.toHaveProperty(gone);
  }
});

test("the same protocol is accepted; an older or newer one is refused before any request", async () => {
  const same = await fakeService({ protocolVersion: PROTOCOL });
  await expect(new OutlinerClient(same.socket).requireCompatibleService()).resolves.toMatchObject({ protocolVersion: PROTOCOL });

  const older = await fakeService({ protocolVersion: PROTOCOL - 1 });
  await expect(new OutlinerClient(older.socket).requireCompatibleService()).rejects.toThrow(
    `this Outliner client speaks protocol ${PROTOCOL} and the outline host protocol ${PROTOCOL - 1}: restart the outline host on current code`,
  );
  const newer = await fakeService({ protocolVersion: PROTOCOL + 1 });
  await expect(new OutlinerClient(newer.socket).requireCompatibleService()).rejects.toThrow(
    `this Outliner client speaks protocol ${PROTOCOL} and the outline host protocol ${PROTOCOL + 1}: update the Outliner client`,
  );
  expect([...older.actions, ...newer.actions]).toEqual(["ping", "ping"]);
});

test("the CLI refuses a service on another protocol without sending its request", async () => {
  const { socket, actions } = await fakeService({ protocolVersion: PROTOCOL - 1 });
  const root = temporaryDirectory();
  const child = Bun.spawn([process.execPath, "src/cli.ts", "changes", "--since", "0"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, EP0CH_SOCKET: socket, EP0CH_WS: "scratch",
      OUTLINER_WORKSPACE_ROOT: root, EP0CH_OUTLINES: join(root, "state") },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5_000,
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode).toBe(1);
  expect(stderr).toContain("restart the outline host on current code");
  expect(actions).toEqual(["ping"]);
});

test("a missing protocol number is refused like an older service", () => {
  const unnumbered = { status: "ready" } as unknown as OutlinerServiceStatus;
  expect(checkServiceCompatibility(unnumbered)?.message).toContain("restart the outline host on current code");
  expect(checkServiceCompatibility({ status: "ready", protocolVersion: PROTOCOL })).toBeUndefined();
});

function scriptedPing(responses: Array<OutlinerServiceStatus | Error>) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async request<T>(): Promise<T> {
      const response = responses[Math.min(calls++, responses.length - 1)]!;
      if (response instanceof Error) throw response;
      return response as T;
    },
  };
}

test("the launcher wait accepts a service that restarts onto this protocol", async () => {
  const current: OutlinerServiceStatus = { status: "ready", protocolVersion: PROTOCOL };
  const client = scriptedPing([
    new Error("connect ENOENT"),
    { status: "ready", protocolVersion: PROTOCOL - 1 },
    current,
  ]);
  await expect(waitForCompatibleService(client, { timeoutMs: 5_000 })).resolves.toBe(current);
  expect(client.calls).toBe(3);
});

test("the launcher wait still reports a service on another protocol at its deadline", async () => {
  const client = scriptedPing([{ status: "ready", protocolVersion: PROTOCOL - 1 }]);
  await expect(waitForCompatibleService(client, { timeoutMs: 250 })).rejects.toThrow("restart the outline host on current code");
  expect(client.calls).toBeGreaterThan(1);
});
