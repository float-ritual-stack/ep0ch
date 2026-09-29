// Painting: each frame is one synchronized write, and a row is never blank on its way to new text (PIE-462).
import { afterEach, describe, expect, test } from "bun:test";
import { Mirror } from "../src/mirror";
import { rowBytes, Term } from "../src/term";

const SYNC_ON = "\x1b[?2026h", SYNC_OFF = "\x1b[?2026l";
let written: string[] = [];
const realWrite = process.stdout.write;

function term(cols = 20, rows = 3): Term {
  written = [];
  process.stdout.write = ((s: string) => { written.push(String(s)); return true; }) as typeof process.stdout.write;
  const t = new Term();
  t.info = { cols, rows, cellW: 9, cellH: 18, kitty: false };
  return t;
}
afterEach(() => { process.stdout.write = realWrite; });

describe("painting a frame", () => {
  test("the changed rows go out as one write, wrapped in a synchronized update", () => {
    const t = term();
    t.paint(["jam jars", "bread tins", "status"]);
    expect(written).toHaveLength(1);
    expect(written[0]!.startsWith(SYNC_ON)).toBe(true);
    expect(written[0]!.endsWith(SYNC_OFF)).toBe(true);
    for (const text of ["jam jars", "bread tins", "status"]) expect(written[0]).toContain(text);
  });

  test("unchanged rows write nothing, not even an empty synchronized update", () => {
    const t = term();
    t.paint(["a", "b", "c"]);
    t.paint(["a", "b", "c"]);
    expect(written).toHaveLength(1);
  });

  test("a row is written text first, then cleared to its right; never erased whole first", () => {
    const t = term(20);
    t.paint(["shelf", "", ""]);
    expect(written[0]).not.toContain("\x1b[2K");
    expect(written[0]).toContain("\x1b[1;1H\x1b[0mshelf\x1b[0m\x1b[K");
  });

  test("a row that fills the width gets no erase, which would take its last character with autowrap off", () => {
    const t = term(10, 1);
    t.paint(["0123456789"]);
    expect(written[0]).toContain("0123456789\x1b[0m");
    expect(written[0]).not.toContain("\x1b[K");
  });

  test("text and images written inside one frame go out together, as the door's redraw does", () => {
    const t = term();
    const kittyPlacement = "\x1b_Ga=p,i=7\x1b\\";
    t.frame(() => { t.paint(["board", "", ""]); t.write(kittyPlacement); });
    expect(written).toHaveLength(1);
    expect(written[0]).toBe(`${SYNC_ON}${written[0]!.slice(SYNC_ON.length, -SYNC_OFF.length)}${SYNC_OFF}`);
    expect(written[0]!.indexOf("board")).toBeLessThan(written[0]!.indexOf(kittyPlacement));
    expect(written[0]!.split(SYNC_ON)).toHaveLength(2);                  // nested frames join the outer one
  });

  test("the status row repainted alone is its own synchronized update", () => {
    const t = term(20, 3);
    t.paint(["a", "b", "12:00"]);
    written = [];
    t.paintRow(2, "12:01");
    expect(written).toEqual([`${SYNC_ON}\x1b[3;1H\x1b[0m12:01\x1b[0m\x1b[K${SYNC_OFF}`]);
  });

  test("outside a frame, writes still go straight out", () => {
    const t = term();
    t.write("\x1b[?25l");
    expect(written).toEqual(["\x1b[?25l"]);
  });

  test("the door's own screen copy (peek, snap) clears what a shorter row leaves behind", () => {
    const t = term(24, 2);
    const mirror = new Mirror(24, 2);
    t.paint(["a long row about the jars", "status"]);
    t.paint(["short row", "status"]);
    for (const w of written) mirror.write(w);
    expect(mirror.text()[0]!.trimEnd()).toBe("short row");
  });

  test("the screen copy knows every erase in line: to the right, to the left, the whole row", () => {
    const mirror = new Mirror(10, 1);
    mirror.write("\x1b[1;1H0123456789\x1b[1;4H\x1b[K");
    expect(mirror.text()[0]).toBe("012");                          // text() trims trailing blanks
    mirror.write("\x1b[1;1H0123456789\x1b[1;4H\x1b[1K");
    expect(mirror.text()[0]).toBe("    456789");
    mirror.write("\x1b[1;1H0123456789\x1b[2K");
    expect(mirror.text()[0]).toBe("");
  });

  test("filling the width is measured in terminal cells, not characters", () => {
    // Combining marks and joined emoji take fewer cells than characters: still room to the right, so erase it.
    expect(rowBytes(0, "cafe\u0301".padEnd(10), 10)).toEndWith("\x1b[K");
    expect(rowBytes(0, "pair \u{1F469}\u200D\u{1F4BB}".padEnd(10), 10)).toEndWith("\x1b[K");
    // Wide characters take two cells: a row of five fills ten columns, so no erase takes its last one.
    expect(rowBytes(0, "\u6F22\u5B57\u6F22\u5B57\u6F22", 10)).not.toContain("\x1b[K");
  });
});

