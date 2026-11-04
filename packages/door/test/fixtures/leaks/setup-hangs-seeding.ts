// A setup that can never finish: its host stops answering partway, so the seed waits for good. A longer budget mustn't
// hide this: it still fails at the limit, and what's left afterwards names the setup (test/test-leaks.test.ts). Its
// afterAll throws before disposing, as the door's did when a setup timed out with no desk yet.
import { afterAll, beforeAll, describe, test } from "bun:test";
import { Scratch } from "../../scratch";

describe("a broken seed", () => {
  const scratch = new Scratch();
  const desk = undefined as unknown as { dispose(): void };
  beforeAll(async () => {
    await scratch.start();
    process.kill(scratch.pid!, "SIGSTOP");
    await scratch.seedShowcase();
  }, 1500);
  afterAll(async () => { desk.dispose(); await scratch.dispose(); });
  test("never runs", () => {});
});
