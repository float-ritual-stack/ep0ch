// The file after it: the terminal in the group ended with the file that left it.
import { expect, test } from "bun:test";

test("the group's terminal ended", () => {
  expect((globalThis as { groupProbe?: { terminal: boolean } }).groupProbe?.terminal).toBe(true);
});
