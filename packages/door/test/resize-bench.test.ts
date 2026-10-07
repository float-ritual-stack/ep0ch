// A resize stays within its budget (PIE-623): the resize bench (scripts/bench-resize.ts) drags a border across the
// showcase's desk and nothing is scaled, made or uploaded until it's let go, then what the new sizes need is; and a
// frame writes at most BUDGET.bytesPerCell. Its frame times aren't checked here (a shared machine's say nothing):
// `bun run bench:resize --check-time` in a box does. And the parts it rests on: a canvas cell's style keeps one colour,
// and a resize holds and lets go.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BUDGET, broken, type Summary } from "../scripts/bench-resize";
import { Canvas, withSgr } from "../src/canvas";
import { inResize, onResizeEnd, resizeEnded, resizing } from "../src/resize";
import { outliner } from "./scratch";

const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`, bg = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;

describe("a canvas cell's style", () => {
  test("a colour replaces the one before it: a backdrop's colour per cell stays one colour a cell", () => {
    expect(withSgr(fg(1, 2, 3), fg(4, 5, 6))).toBe(fg(4, 5, 6));
    expect(withSgr(fg(1, 2, 3) + bg(9, 9, 9), bg(7, 7, 7))).toBe(fg(1, 2, 3) + bg(7, 7, 7));
    // Bold and the like stay; a colour after them replaces only the colour.
    expect(withSgr("\x1b[1m" + fg(1, 2, 3), fg(4, 5, 6))).toBe("\x1b[1m" + fg(4, 5, 6));
    // A row of 60 cells, each its own background (overColours): its bytes grow with the cells, not their square.
    const c = new Canvas(60, 1);
    c.text(0, 0, Array.from({ length: 60 }, (_, i) => bg(i, i, i) + "x").join(""));
    expect(c.lines()[0]!.length).toBeLessThan(60 * 40);
  });
});

describe("a resize", () => {
  test("holds while its reports come, and ends when let go or after its hold, said once", async () => {
    let ends = 0;
    const off = onResizeEnd(() => ends++);
    try {
      resizing(1000);
      expect(inResize()).toBe(true);
      resizeEnded();
      expect(inResize()).toBe(false);
      expect(ends).toBe(1);
      resizeEnded();
      expect(ends).toBe(1);
      resizing(30);
      await Bun.sleep(80);
      expect(inResize()).toBe(false);
      expect(ends).toBe(2);
    } finally { off(); }
  });
});

describe.skipIf(!outliner)("the resize bench, within budget", () => {
  test("a border dragged across the showcase's desk, Kitty graphics on and off: nothing scaled or uploaded until it's let go; bytes a frame within budget", async () => {
    const p = Bun.spawn(["bun", join(import.meta.dir, "../scripts/bench-resize.ts"), "--only", "kitty@120x40,cells@120x40", "--runs", "1", "--span", "10", "--json"], { stdout: "pipe", stderr: "pipe", env: process.env as Record<string, string> });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    expect({ code: await p.exited, err: err.slice(-2000) }).toEqual({ code: 0, err: expect.any(String) });
    const runs = JSON.parse(out) as Summary[];
    expect(runs.map(r => r.config)).toEqual(["kitty@120x40", "cells@120x40"]);
    for (const r of runs) {
      expect({ config: r.config, broken: broken(r) }).toEqual({ config: r.config, broken: [] });
      expect(r.frames).toBeGreaterThan(5);
      expect(r.bytesPerFrame / (120 * 40)).toBeLessThanOrEqual(BUDGET.bytesPerCell);
    }
  }, 180_000);
});
