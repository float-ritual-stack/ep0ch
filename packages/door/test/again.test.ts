// The one "press it again" rule (PIE-1293): the same press within the window confirms, anything else lets it go.
import { describe, expect, test } from "bun:test";
import { Again, AGAIN_MS } from "../src/arm";

describe("Again", () => {
  test("the same press within the window confirms; once", () => {
    const a = new Again<string>();
    a.arm("trash", 0);
    expect(a.armed(10)).toBe("trash");
    expect(a.take("trash", 10)).toBe(true);
    expect(a.take("trash", 20)).toBe(false);
  });
  test("another press, or the window running out, lets it go", () => {
    const a = new Again<string>();
    a.arm("trash", 0);
    expect(a.take("revert", 10)).toBe(false);
    expect(a.take("trash", 20)).toBe(false);
    a.arm("trash", 0);
    expect(a.armed(AGAIN_MS)).toBeNull();
    expect(a.take("trash", AGAIN_MS)).toBe(false);
  });
});
