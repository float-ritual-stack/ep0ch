// A test file that starts a scratch host and never stops it: the check names it, and it is stopped before the next
// file runs (test/test-leaks.test.ts reads the pid it prints).
import { expect, test } from "bun:test";
import { Scratch } from "../../scratch";

test("a scratch host left running", async () => {
  const scratch = new Scratch();
  await scratch.start();
  console.log(`scratch pid ${(scratch as unknown as { proc: { pid: number } }).proc.pid}`);
  expect(scratch.running).toBe(true);
});
