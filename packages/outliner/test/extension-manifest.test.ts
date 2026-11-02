import { expect, test } from "bun:test";
import { loadExtensionManifest } from "../src/extension-manifest";

function load(actions: Record<string, unknown>[]) {
  return loadExtensionManifest({ origin: "outline", directory: "/scratch/seeds", expectedId: "seeds", idFrom: "folder", configRaw: "{}",
    manifestRaw: JSON.stringify({ contract: 2, id: "seeds", version: 1, name: "Seeds", run: ["bun", "seeds.ts"], actions,
      facetSources: [{ id: "catalogue", title: "Catalogue", read: "rows" }] }) });
}

test("facet sources accept the default read effects", () => {
  expect(() => load([{ id: "rows", label: "Read seeds", on: "outline" }])).not.toThrow();
});

test.each([
  [[], /rows.*not declared/],
  [[{ id: "rows", label: "Read seeds", on: "block" }], /rows.*on.*outline/],
  [[{ id: "rows", label: "Read seeds", on: "outline", effects: "write" }], /rows.*effects.*read/],
] as const)("facet source validation identifies the failed requirement: %j", (actions, error) => {
  expect(() => load([...actions])).toThrow(error);
});
