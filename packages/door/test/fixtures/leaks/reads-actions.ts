// The file after a leaky one: what it sees is the run's starting state (no extension's actions bound, no env var
// an earlier file set), as test/dispatch.test.ts expects of allActionSets().
import { expect, test } from "bun:test";
import { allActionSets } from "../../../src/surface/actions";

test("no earlier file's extension actions or env vars", () => {
  expect(allActionSets().flatMap(s => s.names())).not.toContain("ext.tarot.draw");
  expect(process.env.EP0CH_LEAK_PROBE).toBeUndefined();
});
