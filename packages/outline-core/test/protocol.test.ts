import { expect, test } from "bun:test";
import { OUTLINE_NAME_PATTERN, PROTOCOL, protocolMismatch } from "../src/protocol";

test("the same protocol is accepted", () => {
  expect(protocolMismatch(PROTOCOL)).toBeUndefined();
});

test("an older service is refused: restart the outline host", () => {
  expect(protocolMismatch(PROTOCOL - 1, "this door")).toBe(
    `this door speaks protocol ${PROTOCOL} and the outline host protocol ${PROTOCOL - 1}: restart the outline host on current code (ep0ch install --apply updates and restarts it)`);
  expect(protocolMismatch(undefined, "this door")).toContain("restart the outline host on current code");
});

test("a newer service is refused: update the client", () => {
  expect(protocolMismatch(PROTOCOL + 1, "this door")).toBe(
    `this door speaks protocol ${PROTOCOL} and the outline host protocol ${PROTOCOL + 1}: update the door (ep0ch install --apply) and restart it`);
});

test("outline names are short slugs", () => {
  for (const name of ["pie", "float-hub", "a1", "x".repeat(32)]) expect(OUTLINE_NAME_PATTERN.test(name)).toBe(true);
  for (const name of ["", "-x", "Pie", "a b", "x".repeat(33), "a/b"]) expect(OUTLINE_NAME_PATTERN.test(name)).toBe(false);
});
