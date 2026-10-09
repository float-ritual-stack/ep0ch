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
  const handle = first.handleOf("c-0a0a0a0a0a");
  expect(handle).toBe(seedHandle("c-0a0a0a0a0a"));
  expect(first.handleOf("c-0a0a0a0a0a")).toBe(handle);
  first.close();
  const again = new CallRegistry(path);
  expect(again.handleOf("c-0a0a0a0a0a")).toBe(handle);
  expect(again.idOf(handle)).toBe("c-0a0a0a0a0a");
  expect(again.idOf("no_such_handle")).toBeNull();
  again.close();
});

test("a clash takes _2 inside the write that checks the index, and both handles resolve to their own id", () => {
  const r = new CallRegistry(join(dir, "b", "calls.sqlite"));
  // An agent-chosen id is its own handle; a second id that seeds the same handle can't be forced, so take its handle first.
  const seed = seedHandle("c-1234567890");
  expect(r.handleOf(seed)).toBe(seed); // the agent called itself exactly that
  expect(r.handleOf("c-1234567890")).toBe(`${seed}_2`);
  expect(r.idOf(seed)).toBe(seed);
  expect(r.idOf(`${seed}_2`)).toBe("c-1234567890");
  r.close();
});

test("call:<handle> in a query is swapped for the id; an id or an unknown word stays", () => {
  const r = new CallRegistry(join(dir, "c", "calls.sqlite"));
  const h = r.handleOf("c-abcdef0123");
  expect(r.resolveIn(`type=note call:${h}`)).toBe("type=note call:c-abcdef0123");
  expect(r.resolveIn("call:c-abcdef0123")).toBe("call:c-abcdef0123");
  expect(r.resolveIn("call:nobody_here")).toBe("call:nobody_here");
  r.close();
});

test("a quoted search for call:… is not an atom, and a known id is never taken for a handle", () => {
  const r = new CallRegistry(join(dir, "d", "calls.sqlite"));
  const h = r.handleOf("c-abcdef0123");
  expect(r.resolveIn(`text~"call:${h}"`)).toBe(`text~"call:${h}"`);
  expect(r.resolveIn(`CALL:${h}`)).toBe("call:c-abcdef0123");
  // An agent that names its call exactly like another call's handle: its own id keeps meaning itself.
  expect(r.handleOf(h)).toBe(`${h}_2`);
  expect(r.resolveIn(`call:${h}`)).toBe(`call:${h}`);
  r.close();
});
