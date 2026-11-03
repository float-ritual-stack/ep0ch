// PIE-1544 (card 14): the dispatcher writes every answer's envelope and retries a busy database once, for every branch.
// search.picked and suggestions.keep caught SQLITE_BUSY themselves, so a write that met a held lock failed instead of
// being tried again. Another connection holds the writer for a moment; the store waits for nobody (busy_timeout 0), so
// the first try meets the lock and the dispatcher's one retry lands. Fictional notes, a scratch outline.
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scratchOutline } from "./scratch-outline";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { OutlinerRequest } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-busy-"));
  const paths = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket);
  await server.start();
  const other = new Database(paths.database);
  cleanups.push(async () => { other.close(); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  store.database.exec("PRAGMA busy_timeout = 0");
  /** Another writer holds the database for `ms`, then lets go. */
  const holdFor = (ms: number) => { other.exec("BEGIN IMMEDIATE"); return Bun.sleep(ms).then(() => other.exec("COMMIT")); };
  return { store, server, holdFor };
}

const asked = (request: Record<string, unknown>) => ({ id: "r1", ...request }) as unknown as OutlinerRequest;

test("search.picked meets a held writer, and the dispatcher's retry lands it", async () => {
  const { store, server, holdFor } = await setup();
  const note = store.create("Seed swap");
  const released = holdFor(20);
  const answer = await server.handleAsync(asked({ action: "search.picked", query: "seed swap", blockId: note.id, rank: 0, surface: "power-bar" }));
  await released;
  expect(answer).toMatchObject({ ok: true, result: { kept: 1 } });
});

test("suggestions.keep meets a held writer, and the dispatcher's retry lands it", async () => {
  const { store, server, holdFor } = await setup();
  const note = store.create("Pea rows");
  const released = holdFor(20);
  const answer = await server.handleAsync(asked({ action: "suggestions.keep", keep: { kind: "reviewed", at: { note: note.id, revision: note.revision, actorId: "kitty/claude-code@shed", source: "backfill" }, title: "Pea rows", review: { verdict: "ship", findings: [], jev: "asked", next: "" } } }));
  await released;
  expect(answer).toMatchObject({ ok: true });
});

test("a refusal is still one envelope: ok false, the words, the sequence", async () => {
  const { server, store } = await setup();
  const answer = await server.handleAsync(asked({ action: "search.picked", query: "seed swap", blockId: "nope", rank: -1, surface: "power-bar" }));
  expect(answer).toMatchObject({ id: "r1", ok: false, sequence: store.sequence });
  expect((answer as { error: string }).error).toMatch(/rank/);
});
