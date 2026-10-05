import { describe, expect, test } from "bun:test";
import { showcaseTry } from "../src/showcase/route";

describe("ep0ch --showcase", () => {
  test("without --ws it is the seeded showcase (try-it.sh --showcase), --reset carried", () => {
    expect(showcaseTry(["--showcase"])).toEqual(["--showcase"]);
    expect(showcaseTry(["--showcase", "--reset"])).toEqual(["--showcase", "--reset"]);
  });
  test("with --ws (try-it.sh's own call) it opens the screen on that outline", () => {
    expect(showcaseTry(["--no-daemon", "--ws", "showcase", "--showcase"])).toBeNull();
  });
  test("anything else is not the showcase", () => {
    expect(showcaseTry(["--screen", "desk"])).toBeNull();
  });
});
