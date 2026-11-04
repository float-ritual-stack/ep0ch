// A setup that hangs once its host is up: Bun ends the file's processes at the limit, the host with them, so what the
// check finds is a host Bun ended, never one still running (test/test-leaks.test.ts). Its afterAll throws before
// disposing, as the door's did when a setup timed out with no desk yet.
import { afterAll, beforeAll, describe, test } from "bun:test";
import { Scratch } from "../../scratch";

describe("a setup that hangs", () => {
  const scratch = new Scratch();
  const desk = undefined as unknown as { dispose(): void };
  beforeAll(async () => {
    await scratch.start();
    await new Promise(() => {});
  }, 1500);
  afterAll(async () => { desk.dispose(); await scratch.dispose(); });
  test("never runs", () => {});
});
