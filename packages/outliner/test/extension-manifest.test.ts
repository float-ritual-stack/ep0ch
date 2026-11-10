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

// Screens (PIE-1525): a manifest may ship whole screens for the door, opaque here past their names.
function withScreens(screens: unknown[]) {
  return loadExtensionManifest({ origin: "outline", directory: "/scratch/rota", expectedId: "rota", idFrom: "folder", configRaw: "{}",
    manifestRaw: JSON.stringify({ contract: 2, id: "rota", version: 1, name: "Rota", screens }) });
}

test("an extension may ship only screens; each keeps what it wrote, menu and all, for the door to read", () => {
  const spec = { name: "rota", title: "the rota", menu: { key: "R", label: "Rota" }, layout: { root: { t: "leaf", kind: "reader", name: "reader" } } };
  expect(withScreens([spec]).manifest.screens).toEqual([spec]);
});

test.each([
  [[{ title: "no name" }], /screens\/0/],
  [[{ name: "9lives" }], /screens\/0/],
  [[{ name: "rota" }, { name: "rota" }], /screens\/1\/name rota is declared twice/],
] as const)("a screen with no name, a bad name or a name twice is refused, naming it: %j", (screens, error) => {
  expect(() => withScreens([...screens])).toThrow(error);
});

// A kit's rule runs a script it ships (PIE-1509): `script:<name>` in `on`, with no `run` program and no actions[].
function withScriptRule(on: Record<string, string>, scripts = [{ name: "sow-row", file: "scripts/sow-row.js", about: "Sows a row" }]) {
  return loadExtensionManifest({ origin: "outline", directory: "/scratch/sower", expectedId: "sower", idFrom: "folder", configRaw: "{}",
    manifestRaw: JSON.stringify({ contract: 2, id: "sower", version: 1, name: "Sower", scripts, rules: [{ id: "sow", match: { property: "bed" }, on }] }) });
}

test("a rule may run a script its extension ships, by script:<name>", () => {
  expect(withScriptRule({ start: "script:sow-row", change: "script:sow-row" }).manifest.rules?.[0]?.on).toMatchObject({ start: "script:sow-row" });
});

test.each([
  [{ start: "script:weed-row" }, /rules\/0\/on\/start names script:weed-row, which scripts\[\] doesn't declare/],
  [{ change: "sow-row" }, /rules\/0\/on\/change names sow-row, which actions\[\] doesn't declare/],
] as const)("a rule naming a script or action its extension doesn't have is refused, naming it: %j", (on, error) => {
  expect(() => withScriptRule({ ...on })).toThrow(error);
});
