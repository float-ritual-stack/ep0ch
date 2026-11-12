// The file after a leaky one: what it sees is the run's starting state (no extension's actions bound, no fake action
// set an earlier file made, no env var an earlier file set), as test/dispatch.test.ts and test/action-pages.test.ts
// expect of allActionSets().
import { expect, test } from "bun:test";
import "../../../src/macros";
import { allActionSets } from "../../../src/surface/actions";

test("no earlier file's extension actions, fake action sets or env vars", () => {
  expect(allActionSets().flatMap(s => s.names())).not.toContain("ext.tarot.draw");
  const scopes = allActionSets().map(s => s.scope);
  expect(scopes).not.toContain("fixture-fake");
  expect(scopes).not.toContain("fixture-helper");
  // A built-in, whichever file imported it first, is still the door's.
  expect(scopes).toContain("macros");
  expect(process.env.EP0CH_LEAK_PROBE).toBeUndefined();
});
