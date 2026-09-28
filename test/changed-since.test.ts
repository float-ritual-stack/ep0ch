import { expect, test } from "bun:test";
import { SocketBoard } from "../src/socket";

// New Scan asks the service for `updated > since` with list fields when it can (PIE-398), and only
// falls back to fetching the newest N whole notes and filtering locally on older services.
function fakeBoard(capabilities: string[] | null) {
  const b = new SocketBoard("/nonexistent.sock");
  const sent: any[] = [];
  b.capabilities = capabilities ? new Set(capabilities) : null;
  (b as any).request = async (_action: string, params: any) => { sent.push(params); return { blocks: [] }; };
  return { b, sent };
}

test("with query.expression, New Scan sends an updated range and list fields", async () => {
  const { b, sent } = fakeBoard(["query.expression", "blocks.read"]);
  const since = Date.parse("2026-09-28T12:00:00Z");
  await b.changedSince(since, 400);
  expect(sent[0].query.expression).toBe("updated>2026-09-28T12:00:00.000Z");
  expect(sent[0].query.sort).toEqual({ field: "updated", direction: "desc" });
  expect(sent[0].fields).toBeDefined();
});

test("a first call (since 0) asks for the newest, still as list rows", async () => {
  const { b, sent } = fakeBoard(["query.expression", "blocks.read"]);
  await b.changedSince(0, 200);
  expect(sent[0].query.expression).toBeUndefined();
  expect(sent[0].fields).toBeDefined();
});

test("without query.expression it never sends an expression the service might ignore", async () => {
  const { b, sent } = fakeBoard([]);
  await b.changedSince(Date.now() - 1000, 400);
  expect(sent[0].query.expression).toBeUndefined();
  expect(sent[0].fields).toBeUndefined();
});
