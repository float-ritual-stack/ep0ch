// The scaled-image cache in memory (src/media.ts `ScaledCache`): held to its byte budget, least recently drawn first,
// never evicting what the last two frames drew. No image is read or scaled here: the PNGs are made-up buffers.
import { describe, expect, test } from "bun:test";
import { ScaledCache, type PngRef } from "../src/media";

const png = (bytes: number, key: string): PngRef => ({ png: Buffer.alloc(bytes), width: 1, height: 1, key });

describe("the scaled-image cache", () => {
  test("resizing again and again while a scale is pending: the closest one drawn meanwhile moves up, and the cache stays under budget", () => {
    const c = new ScaledCache(1000);
    let frame = 0;
    // A garden photo scaled at a few steps over earlier frames: the oldest first.
    c.put("garden\x00320", png(300, "a"), frame);
    c.put("garden\x00640", png(300, "b"), frame);
    c.put("garden\x00960", png(300, "c"), frame);
    for (let i = 0; i < 20; i++) {
      frame += 3;
      // The exact step isn't ready: the oldest one is drawn meanwhile (`sized`'s closest pick), and then the scale lands.
      c.use("garden\x00320", frame);
      c.put(`garden\x00step${i}`, png(300, `s${i}`), frame);
      // Only what's on screen (drawn this frame or the last) may hold it over budget.
      expect(c.bytes).toBeLessThanOrEqual(1000);
      expect(c.get("garden\x00320")).toBeDefined();
    }
  });

  test("a scale that just landed isn't pushed out by the next one before it's drawn; older ones go first", () => {
    const c = new ScaledCache(1000);
    c.put("old\x00a", png(400, "a"), 0);
    // Two scales land in the same frame, before a redraw: a goes, and both new ones stay though that's over budget.
    c.put("new\x00b", png(400, "b"), 5);
    c.put("new\x00c", png(400, "c"), 5);
    c.put("new\x00d", png(400, "d"), 5);
    expect(c.get("old\x00a")).toBeUndefined();
    expect(["b", "c", "d"].map(k => !!c.get(`new\x00${k}`))).toEqual([true, true, true]);
    // Two frames on, undrawn, they go oldest first.
    c.put("new\x00e", png(100, "e"), 8);
    expect(c.bytes).toBeLessThanOrEqual(1000);
    expect(c.get("new\x00b")).toBeUndefined();
  });

  test("nothing but what's on screen: kept over budget, never evicted mid-frame", () => {
    const c = new ScaledCache(500);
    c.put("x\x00a", png(400, "a"), 7);
    c.use("x\x00a", 7);
    c.put("x\x00b", png(400, "b"), 7);
    expect(c.get("x\x00a")).toBeDefined();
    expect(c.get("x\x00b")).toBeDefined();
  });

  test("forgetting a content key drops its steps and their bytes", () => {
    const c = new ScaledCache(10_000);
    c.put("k1\x00320", png(100, "a"), 0);
    c.put("k1\x00640", png(200, "b"), 0);
    c.put("k2\x00320", png(50, "c"), 0);
    c.forget("k1");
    expect(c.bytes).toBe(50);
    expect([...c.entries()].map(([k]) => k)).toEqual(["k2\x00320"]);
  });
});
