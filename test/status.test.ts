// The status bar: its right part (video, uptime, clock) always shows whole, set apart by a separator.
import { describe, expect, test } from "bun:test";
import { statusLine } from "../src/app";
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
