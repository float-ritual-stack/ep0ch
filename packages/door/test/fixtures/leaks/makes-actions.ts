// A test file that makes fake action sets of its own, as test/dispatch.test.ts's fake screen does, and still holds them
// when it ends (garbage collection hasn't run): the next file's allActionSets() is the door's own all the same
// (PIE-1774; test/test-leaks.test.ts runs it, then reads-actions.ts). The built-in set this file is the first to import
// (macros) stays: it is the door's, not the file's.
import { expect, test } from "bun:test";
import { MACRO_ACTIONS } from "../../../src/macros";
import { ActionSet, actionSet, allActionSets } from "../../../src/surface/actions";

const held = [
  new ActionSet<{ "fake.go": { to: string } }, null>("fixture-fake", {
    "fake.go": { summary: "go somewhere", touches: "nothing", replay: "safe", args: { to: { type: "string", about: "where" } }, run: () => null },
  }),
  actionSet<null>()("fixture-helper", { "fake.stay": { summary: "stay put", touches: "nothing", replay: "safe", args: { here: { type: "string", about: "where" } }, run: () => null } }),
];

test("a file's own fake sets are listed while it runs", () => {
  const scopes = allActionSets().map(s => s.scope);
  expect(scopes).toContain("fixture-fake");
  expect(scopes).toContain("fixture-helper");
  expect(MACRO_ACTIONS.names().length).toBeGreaterThan(0);
  expect(held).toHaveLength(2);
});
