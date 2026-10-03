// `outliner mentions list`: what Claude's Recent mentions pane reads (packages/claude-mod): one conversation's mentions
// (--agent and --session, as the Tree's s key scopes them), at most --limit, each with the title Tree and Detail show.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { scratchOutline } from "./scratch-outline";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-cli-mentions-"));
  const { env, ...paths } = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const client = new OutlinerClient(paths.socket);
  cleanups.push(async () => { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  async function run(args: string[]) {
    const child = Bun.spawn(["bun", "src/cli.ts", "mentions", "list", ...args], {
      cwd: join(import.meta.dir, ".."), env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  }
  return { root, store, client, run };
}

test("mentions list: one conversation's, newest first, at most --limit, each with its title", async () => {
  const { root, store, client, run } = await setup();
  const shed = store.create("Bike shed [page::bike-shed]\nWhere the bikes live.");
  const oil = store.create("Chain oil\nThe wax one.");
  const ingest = (sessionId: string, messageId: string, text: string) =>
    client.request({ action: "mentions.ingest", message: { workspaceRoot: root, agent: "claude", sessionId, messageId, text } });
  await ingest("s-1", "m-1", "See [[bike-shed]].");
  await ingest("s-1", "m-2", `And ((${oil.id})), and [[no-such-page]].`);
  await ingest("s-2", "m-1", `Elsewhere ((${shed.id})).`);

  const mine = await run(["--agent", "claude", "--session", "s-1"]);
  expect(mine.exitCode).toBe(0);
  const found = JSON.parse(mine.stdout) as { entries: { title: string; address: string; block: { id: string } | null; sessionId: string }[] };
  expect(found.entries.map(e => [e.title, e.block?.id ?? null])).toEqual([["Chain oil", oil.id], ["no-such-page", null], ["Bike shed", shed.id]]);
  expect(found.entries.every(e => e.sessionId === "s-1")).toBe(true);

  const one = JSON.parse((await run(["--agent", "claude", "--session", "s-1", "--limit", "1"])).stdout) as { entries: unknown[]; completeness: { kind: string } };
  expect([one.entries.length, one.completeness.kind]).toEqual([1, "truncated"]);
  // Unscoped, every conversation's (the workspace's), as before.
  expect((JSON.parse((await run([])).stdout) as { entries: { sessionId: string }[] }).entries.some(e => e.sessionId === "s-2")).toBe(true);
});

test("mentions list refuses half a scope and a limit that isn't a number", async () => {
  const { run } = await setup();
  expect((await run(["--agent", "claude"])).stderr).toContain("both --agent and --session");
  expect((await run(["--limit", "lots"])).exitCode).not.toBe(0);
  expect((await run(["--limit", "500"])).stderr).toContain("1–100");
});
