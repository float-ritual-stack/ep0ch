// Run by test/root-preload.test.ts as `bun test` from the repository's root: says whether the outliner's preload ran.
import { expect, test } from "bun:test";

test("the outliner's preload ran", () => {
  expect(process.env.OUTLINER_EXTENSIONS_DIR).toContain("outliner-test-no-user-extensions-");
});
