// The status bar: its right part (video, uptime, clock) always shows whole, set apart by a separator.
import { describe, expect, test } from "bun:test";
import { App, statusLine } from "../src/app";
import { width } from "../src/style";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const right = "kitty+crt │ on 0m │ 09:13 ";

describe("status bar", () => {
  test("a location that fills its room exactly doesn't run into the right part", () => {
    const left = " ep0ch │ board │ float-box:/home/sam/garden";
    const cols = width(left) + 3 + width(right);            // exactly enough for left, separator, right
    const line = plain(statusLine(left, "", right, cols));
    expect(line).toBe(`${left} │ ${right}`);
    expect(width(line)).toBe(cols);
  });

  test("a cut-short location ends in … and the separator and right part stay whole", () => {
    const line = plain(statusLine(" ep0ch │ board │ float-box:/home/sam/a-very-long-garden-path", "", right, 50));
    expect(line.endsWith(`… │ ${right}`)).toBe(true);
    expect(width(line)).toBe(50);
  });

  test("the bar's colours come back after a cut", () => {
    const line = statusLine(" ep0ch │ board │ float-box:/home/sam/a-very-long-garden-path", "", right, 50);
    const afterCut = line.slice(line.indexOf("…"));
    expect(afterCut.indexOf("\x1b[0m")).toBeLessThan(afterCut.indexOf(" │ kitty"));
    expect(afterCut.slice(afterCut.indexOf("\x1b[0m") + 4)).toMatch(/^\x1b\[4[0-9;]*m/);   // background set again
  });
});

describe("the status bar keeps time while the door is idle", () => {
  /** A door on a fake clock and a fake terminal that records what's written, row by row, and every render. */
  function idleDoor(start: number) {
    let now = start, renders = 0;
    const rows: { row: number; text: string }[] = [], raw: string[] = [];
    const term = {
      info: { cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: true },
      write: (s: string) => { raw.push(s); },
      paint(lines: string[]) { lines.forEach((l, r) => rows.push({ row: r, text: plain(l) })); },
      paintRow(r: number, l: string) { rows.push({ row: r, text: plain(l) }); },
      invalidate() {}, onKey() {}, onResize() {},
    };
    const app = new App(term as any, {} as any, start, () => {}, () => now);
    const screen = { title: "board", render: () => { renders++; return { lines: ["an edit in progress"] }; }, key() {} };
    app.push(screen as any);
    const tick = () => (app as any).tick();
    return {
      app, rows, raw, tick,
      get renders() { return renders; },
      at(t: number) { now = t; rows.length = 0; raw.length = 0; },
    };
  }
  const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);

  test("when the minute turns, only the status row is repainted, with the new time; the screen isn't rendered again", () => {
    const start = new Date(2026, 8, 28, 9, 28, 30).getTime();
    const d = idleDoor(start);
    try {
      d.at(start + 20_000);                              // 09:28:50: nothing to change
      d.tick();
      expect(d.rows).toEqual([]);
      const renders = d.renders;
      d.at(start + 30_000);                              // 09:29:00: the clock turns over
      d.tick();
      expect(d.rows.map(r => r.row)).toEqual([29]);
      expect(d.rows[0]!.text).toContain(`on 0m │ ${clock(start + 30_000)}`);
      expect(d.renders).toBe(renders);                   // the edit's frame wasn't redrawn
      expect(d.raw.join("")).not.toContain("\x1b_G");   // no Kitty placement touched
      d.tick();                                          // the same minute again: nothing
      expect(d.rows).toHaveLength(1);
    } finally { d.app.quit(); }
  });

  test("the uptime turning over repaints it too, between clock minutes", () => {
    const start = new Date(2026, 8, 28, 9, 28, 30).getTime();
    const d = idleDoor(start);
    try {
      d.at(start + 30_000); d.tick();                    // 09:29:00, on 0m
      d.at(start + 60_000); d.tick();                    // 09:29:30, on 1m
      expect(d.rows.map(r => r.row)).toEqual([29]);
      expect(d.rows[0]!.text).toContain(`on 1m │ ${clock(start + 60_000)}`);
      d.at(start + 35 * 60_000); d.tick();               // left alone for half an hour
      expect(d.rows[0]!.text).toContain(`on 35m │ ${clock(start + 35 * 60_000)}`);
    } finally { d.app.quit(); }
  });
});
