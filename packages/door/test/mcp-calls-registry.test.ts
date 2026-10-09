// PIE-685: the registry that mints a call's handle once and stores it, id to handle under a unique index.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedHandle } from "@ep0ch/outline-core/call-handles";
import { CallRegistry } from "../src/mcp-calls";

const dir = mkdtempSync(join(tmpdir(), "ep0ch-calls-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a handle is minted once, stored, and the same after the registry is reopened", () => {
  const path = join(dir, "a", "calls.sqlite");
  const first = new CallRegistry(path);
  const handle = first.handleOf("c-0a0a0a");
  expect(handle).toBe(seedHandle("c-0a0a0a"));
  expect(first.handleOf("c-0a0a0a")).toBe(handle);
  first.close();
  const again = new CallRegistry(path);
  expect(again.handleOf("c-0a0a0a")).toBe(handle);
  expect(again.idOf(handle)).toBe("c-0a0a0a");
  expect(again.idOf("no_such_handle")).toBeNull();
  again.close();
});

test("a clash takes _2 inside the write that checks the index, and both handles resolve to their own id", () => {
  const r = new CallRegistry(join(dir, "b", "calls.sqlite"));
  // An agent-chosen id is its own handle; a second id that seeds the same handle can't be forced, so take its handle first.
  const seed = seedHandle("c-123456");
  expect(r.handleOf(seed)).toBe(seed); // the agent called itself exactly that
  expect(r.handleOf("c-123456")).toBe(`${seed}_2`);
  expect(r.idOf(seed)).toBe(seed);
  expect(r.idOf(`${seed}_2`)).toBe("c-123456");
  r.close();
});

test("call:<handle> in a query is swapped for the id; an id or an unknown word stays", () => {
  const r = new CallRegistry(join(dir, "c", "calls.sqlite"));
  const h = r.handleOf("c-abcdef");
  expect(r.resolveIn(`type=note call:${h}`)).toBe("type=note call:c-abcdef");
  expect(r.resolveIn("call:c-abcdef")).toBe("call:c-abcdef");
  expect(r.resolveIn("call:nobody_here")).toBe("call:nobody_here");
  r.close();
});
