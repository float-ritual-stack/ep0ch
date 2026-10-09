import { expect, test } from "bun:test";
import { SocketBoard } from "../src/socket";

// New Scan asks the service for `updated > since` with list fields (PIE-398).
function fakeBoard() {
  const b = new SocketBoard("/nonexistent.sock");
  const sent: any[] = [];
  (b as any).request = async (_action: string, params: any) => { sent.push(params); return { blocks: [] }; };
  return { b, sent };
}

test("with where, New Scan sends an updated range and list fields", async () => {
  const { b, sent } = fakeBoard();
  const since = Date.parse("2026-09-28T12:00:00Z");
  await b.changedSince(since, 400);
  expect(sent[0].query.where).toBe("updated>2026-09-28T12:00:00.000Z");
  expect(sent[0].query.sort).toEqual({ field: "updated", direction: "desc" });
  expect(sent[0].fields).toBeDefined();
});

test("a first call (since 0) asks for the newest, still as list rows", async () => {
  const { b, sent } = fakeBoard();
  await b.changedSince(0, 200);
  expect(sent[0].query.where).toBeUndefined();
  expect(sent[0].fields).toBeDefined();
});
