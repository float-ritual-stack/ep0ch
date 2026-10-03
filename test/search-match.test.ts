// One search (UI-GRAMMAR, "Before adding a feature"): the service ranks every search the door asks
// (`tree.search`, `pages.complete`) with pi-herdr-outliner's src/search-match.ts. The door filters lists it
// already holds (the backlinks drawer, a river column) on every key, so it keeps that file byte for byte in
// src/vendor/search-match.ts: the service's `ping` reports its version, and these tests check the copy.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { matchesSearchText, SEARCH_MATCH_VERSION } from "../src/vendor/search-match";
import { outliner } from "./scratch";

const VENDORED = join(import.meta.dir, "../src/vendor/search-match.ts");
/**
 * The copy's checksum. When pi-herdr-outliner changes its matcher: copy its src/search-match.ts over
 * src/vendor/search-match.ts and put the new checksum here, in the same PR.
 */
const PINNED_SHA256 = "fd6aebd416daf7f0c9bfa1874167f156cbdd7f33ec6991cd925fc42248b0b3ca";

describe("the vendored search matcher", () => {
  test("is the file whose checksum is pinned (an edit to the copy is an edit to the outliner's file first)", () => {
    expect(createHash("sha256").update(readFileSync(VENDORED)).digest("hex")).toBe(PINNED_SHA256);
  });

  test.skipIf(!outliner)("is byte for byte the outliner checkout's src/search-match.ts", () => {
    const theirs = join(outliner!, "src/search-match.ts");
    expect(existsSync(theirs), `${theirs} is missing: the outliner checkout is older than the door's matcher`).toBe(true);
    expect(readFileSync(VENDORED, "utf8"), `copy ${theirs} over src/vendor/search-match.ts and update PINNED_SHA256`).toBe(readFileSync(theirs, "utf8"));
  });

  test("forgives punctuation, word order and a typo in a list filter (fictional rows)", () => {
    expect(SEARCH_MATCH_VERSION).toBeGreaterThan(0);
    expect(matchesSearchText("claude now", ["Claude - now"])).toBe(true);
    expect(matchesSearchText("hats PIE-333", ["PIE-333 Fat cats in party hats"])).toBe(true);
    expect(matchesSearchText("party hast", ["Fat cats in party hats"])).toBe(true);
    expect(matchesSearchText("party zebra", ["Fat cats in party hats"])).toBe(false);
  });
});
