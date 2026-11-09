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

// PIE-1635: the window running out is one moment for everyone. On a busy machine the timer that says so fires late;
// whoever reads the arm first after the window (a paint, peek, a key) finds it gone and its owner told, once.
describe("Again: the window out, read before its timer", () => {
  test("armed() past the window lets it go and says lapsed, once; the late timer says nothing more", async () => {
    const said: string[] = [];
    const a = new Again<string>({ ms: 30, lapsed: what => said.push(what) });
    const t0 = Date.now();
    a.arm("edit", t0);
    expect(a.armed(t0 + 10)).toBe("edit");
    expect(said).toEqual([]);
    expect(a.armed(t0 + 30)).toBeNull();
    expect(said).toEqual(["edit"]);
    await Bun.sleep(60);
    expect(said).toEqual(["edit"]);
  });
  test("a press past the window doesn't confirm, and the owner hears it lapsed", () => {
    const said: string[] = [];
    const a = new Again<string>({ ms: 30, lapsed: what => said.push(what) });
    a.arm("edit", 0);
    expect(a.take("edit", 31)).toBe(false);
    expect(said).toEqual(["edit"]);
    a.arm("edit", 0);
    expect(a.press(31)).toBeNull();
    expect(said).toEqual(["edit", "edit"]);
  });
  test("let go before the window ends, it never says lapsed", () => {
    const said: string[] = [];
    const a = new Again<string>({ ms: 30, lapsed: what => said.push(what) });
    a.arm("edit", 0);
    a.clear();
    expect(a.armed(100)).toBeNull();
    expect(said).toEqual([]);
  });
});
