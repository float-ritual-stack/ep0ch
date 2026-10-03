// Packs are found in the pack folder and in its folders one level down (a tidied woe/ folder).
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packs } from "../src/packs";

test("packs() finds woe zips at the top and one folder down, sorted by name, and ignores everything else", () => {
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-packs-"));
  mkdirSync(join(dir, "woe"));
  mkdirSync(join(dir, ".hidden"));
  writeFileSync(join(dir, "woe0297.zip"), "");
  writeFileSync(join(dir, "woe", "woe0497.zip"), "");
  writeFileSync(join(dir, "woe", "notes.md"), "");
  writeFileSync(join(dir, ".hidden", "woe0999.zip"), "");
  writeFileSync(join(dir, "other.zip"), "");
  expect(packs(dir).map(p => p.slice(dir.length + 1))).toEqual(["woe0297.zip", "woe/woe0497.zip"]);
  expect(packs(join(dir, "missing"))).toEqual([]);
});
