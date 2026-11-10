// Nov 3 review, card 13: every refusal the host sends carries its `kind` on the envelope (outline-core refusal.ts), so a
// client never reads the words to decide what to do next. A table of host refusals -> kind through the real dispatcher,
// and one proof that the kind is the error's own, not a reading of its message. Fictional notes, a scratch outline.
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refusal, REFUSAL_KINDS, refusalKindOf, type RefusalKind } from "@ep0ch/outline-core/refusal";
import { scratchOutline } from "./scratch-outline";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import { refusalEnvelope } from "../src/refusal-envelope";
import { hostBusy, OutlinerRequestError } from "../src/client";
import type { OutlinerRequest } from "../src/types";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function setup(options: { readOnly?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "outliner-kinds-"));
  const paths = scratchOutline(root);
  const store = new OutlinerStore(paths.database, { workspaceRoot: root });
  const server = new OutlinerServer(store, paths.socket, undefined, undefined, options);
  await server.start();
  const other = new Database(paths.database);
  cleanups.push(async () => { other.close(); await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, server, other };
}
const asked = (request: Record<string, unknown>) => ({ id: "r1", ...request }) as unknown as OutlinerRequest;
const kindOf = async (server: OutlinerServer, request: Record<string, unknown>): Promise<RefusalKind | "ok"> => {
  const answer = await server.handleAsync(asked(request));
  return answer.ok ? "ok" : answer.kind;
};

test("host refusals, by what the client can do next", async () => {
  const { store, server } = await setup();
  const note = store.create("Seed swap");
  store.update(note.id, "Seed swap, moved to Saturday", note.revision);
  const rows: Array<[string, Record<string, unknown>, RefusalKind]> = [
    ["a note that isn't there", { action: "get", blockId: "00000000-0000-4000-8000-000000000000" }, "not-found"],
    ["a trash at an old revision", { action: "delete", blockId: note.id, expectedRevision: 1 }, "stale-revision"],
    ["a trash of a note that has text now", { action: "delete", blockId: note.id, ifEmpty: true }, "conflict"],
    ["a query that doesn't parse", { action: "blocks.query", query: { where: "type!=letter" } }, "invalid"],
    ["an action nobody classified", { action: "ui.command.send", command: { targetClientId: "gone", command: "focus" } }, "failed"],
  ];
  for (const [what, request, kind] of rows) expect({ what, kind: await kindOf(server, request) }).toEqual({ what, kind });
});

test("a read-only copy refuses a write with no-access", async () => {
  const { server } = await setup({ readOnly: true });
  expect(await kindOf(server, { action: "artifacts.lease", name: "garden" })).toBe("no-access");
});

test("a store held by another writer is busy, from sqlite's code and not its words", async () => {
  const { store, server, other } = await setup();
  store.database.exec("PRAGMA busy_timeout = 0");
  other.exec("BEGIN IMMEDIATE");
  try { expect(await kindOf(server, { action: "create", text: "Held" })).toBe("busy"); }
  finally { other.exec("COMMIT"); }
});

test("the kind is the error's own: reworded words keep it, and words alone never make one", () => {
  const reworded = refusalEnvelope("r", new Refusal("stale-revision", "a completely different sentence"), 7);
  expect(reworded).toEqual({ id: "r", ok: false, error: "a completely different sentence", kind: "stale-revision", sequence: 7 });
  expect(refusalEnvelope("r", new Error("revision is stale"), 7).kind).toBe("failed");
  expect(refusalKindOf({ kind: "not a kind" })).toBe("failed");
  expect(REFUSAL_KINDS).toContain(refusalKindOf(new Refusal("busy", "x")));
});

test("the client's error carries the envelope's kind, and hostBusy reads it", () => {
  expect(new OutlinerRequestError("slow", undefined, "busy").kind).toBe("busy");
  expect(hostBusy(new OutlinerRequestError("any words", undefined, "busy"))).toBe(true);
  expect(hostBusy(new OutlinerRequestError("still counting: took too long", undefined, "failed"))).toBe(false);
});
