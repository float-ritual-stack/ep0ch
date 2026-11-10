// The owners PIE-1376 folded copies onto, pinned at the edges the copies relied on.
import { expect, test } from "bun:test";
import { sep } from "node:path";
import { canonicalWorkId, isCanonicalWorkId } from "@ep0ch/outline-core/work-ids";
import { backlinkGroupExpanded, backlinkNarrowingActive, DEFAULT_BACKLINK_VIEW_OPTIONS } from "@ep0ch/outline-core/backlink-view";
import { escapesRoot } from "../src/filesystem-source";
import { cancelResponseBody, responseMediaType } from "../src/http-response";
import { sha256 } from "../src/web-markdown";
import { blockingCapabilityFactor, type ResourceCapabilityDecision } from "../src/resources";

test("canonicalWorkId answers only an id written as its canonical form, and parses it", () => {
  expect(canonicalWorkId("PIE-007")).toEqual({ workId: "PIE-007", prefix: "PIE", number: 7 });
  expect(canonicalWorkId("  PIE-007 ")).toEqual({ workId: "PIE-007", prefix: "PIE", number: 7 });
  expect(canonicalWorkId("pie-7")).toBeNull();
  expect(canonicalWorkId("PIE-7")).toBeNull();
  expect(canonicalWorkId("PIE-x")).toBeNull();
  expect(isCanonicalWorkId("PIE-007")).toBe(true);
  expect(isCanonicalWorkId("pie-007")).toBe(false);
});

test("escapesRoot: the root itself and anything under it stay inside; up past it or another drive leaves", () => {
  expect(escapesRoot("")).toBe(false);
  expect(escapesRoot("notes/a.md")).toBe(false);
  expect(escapesRoot("..x")).toBe(false);
  expect(escapesRoot("..")).toBe(true);
  expect(escapesRoot(`..${sep}a.md`)).toBe(true);
  expect(escapesRoot("/elsewhere/a.md")).toBe(true);
});

test("responseMediaType lowercases and drops parameters; a response without one reads as empty", async () => {
  expect(responseMediaType(new Response("{}", { headers: { "content-type": "Application/JSON; charset=utf-8" } }))).toBe("application/json");
  const bare = new Response(null);
  bare.headers.delete("content-type");
  expect(responseMediaType(bare)).toBe("");
  await cancelResponseBody(new Response("unread"));
  await cancelResponseBody(new Response(null));
});

test("sha256 hashes a text as its UTF-8 bytes", () => {
  const text = "café ✓";
  expect(sha256(text)).toBe(sha256(new TextEncoder().encode(text)));
  expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("blockingCapabilityFactor names the first factor that blocks or can't be judged, in the factors' order", () => {
  const decision = (factors: Record<string, unknown>): ResourceCapabilityDecision => ({
    status: "unavailable",
    factors: factors as ResourceCapabilityDecision["factors"],
  });
  expect(blockingCapabilityFactor(undefined)).toBeUndefined();
  const satisfied = { state: "satisfied" };
  const blocked = { state: "blocked", reason: "policy", detail: "Denied by the source's policy" };
  const unknown = { state: "unknown", reason: "unprobed", detail: "Not checked yet" };
  const all = (value: unknown) => new Proxy({}, { get: () => value });
  expect(blockingCapabilityFactor(decision(all(satisfied)))).toBeUndefined();
  expect(blockingCapabilityFactor(decision(all(blocked)))?.detail).toBe("Denied by the source's policy");
  expect(blockingCapabilityFactor(decision(all(unknown)))?.detail).toBe("Not checked yet");
});

test("a backlink group is open when the reader opened it or any filter narrows the view", () => {
  const options = { ...DEFAULT_BACKLINK_VIEW_OPTIONS };
  expect(backlinkNarrowingActive(options)).toBe(false);
  expect(backlinkGroupExpanded(options, new Set(), "reference")).toBe(false);
  expect(backlinkGroupExpanded(options, new Set(["reference"]), "reference")).toBe(true);
  expect(backlinkNarrowingActive({ ...options, filter: "seed" })).toBe(true);
  expect(backlinkGroupExpanded({ ...options, kind: "embed" }, new Set(), "reference")).toBe(true);
});
