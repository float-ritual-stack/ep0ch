// PIE-1614: the order is data, read one way by the hint and by the key.
import { describe, expect, test } from "bun:test";
import { DESK_ESC, DOOR_ESC, DRAFT_ESC, READER_ESC, escNext, escPress, type EscSteps } from "../src/esc-rule";

const ORDER = ["inner", "silent", "outer"] as const;
function steps(open: Partial<Record<(typeof ORDER)[number], string | null>>, ran: string[], takes: boolean | null = true): EscSteps<(typeof ORDER)[number]> {
  const rung = (n: (typeof ORDER)[number]) => () => (n in open ? { closes: open[n] ?? null, ...(n === "silent" && takes !== null ? { maybe: true as const } : {}), run: () => { ran.push(n); return n === "silent" ? takes !== false : true; } } : null);
  return { inner: rung("inner"), silent: rung("silent"), outer: rung("outer") };
}

describe("Esc's rule", () => {
  test("the first open rung closes, and only that one; the hint names it", () => {
    const ran: string[] = [];
    const s = steps({ inner: "the popup", outer: "the edit" }, ran);
    expect(escNext(ORDER, s)).toBe("the popup");
    expect(escPress(ORDER, s)).toBe(true);
    expect(ran).toEqual(["inner"]);
  });
  test("reading changes nothing", () => {
    const ran: string[] = [];
    escNext(ORDER, steps({ inner: "the popup" }, ran));
    expect(ran).toEqual([]);
  });
  test("an owner that says nothing is still asked in its place, and one that takes nothing passes it on", () => {
    const ran: string[] = [];
    expect(escPress(ORDER, steps({ silent: null, outer: "the dock" }, ran, false))).toBe(true);
    expect(ran).toEqual(["silent", "outer"]);
    expect(escNext(ORDER, steps({ silent: null, outer: "the dock" }, []))).toBe("the dock");
  });
  test("a wordless owner that has the key (a program) ends the hint: it never names what's behind it", () => {
    expect(escNext(ORDER, steps({ silent: null, outer: "the drawer" }, [], null))).toBeNull();
  });
  test("nothing open: nothing took it", () => expect(escPress(ORDER, steps({}, []))).toBe(false));
  test("the stated order: what's over a tile, then the tile, then the screen's own; the drawer after what's in front of it", () => {
    const before = (order: readonly string[], a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before(DRAFT_ESC, "popup", "snippet"); before(DRAFT_ESC, "snippet", "selection"); before(DRAFT_ESC, "selection", "draft");
    before(READER_ESC, "mode", "selection"); before(READER_ESC, "selection", "lit");
    before(DESK_ESC, "overlay", "chord"); before(DESK_ESC, "chord", "in-reader"); before(DESK_ESC, "in-reader", "tile"); before(DESK_ESC, "tile", "dock");
    before(DOOR_ESC, "bar", "in-drawer"); before(DOOR_ESC, "screen", "drawer-up"); before(DOOR_ESC, "drawer-up", "home");
  });
});
