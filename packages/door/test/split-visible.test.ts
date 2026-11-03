// PIE-1524: splitVisible, the one cut of a row to a width, sees through colour codes: they take no room and are never cut.
import { expect, test } from "bun:test";
import { splitVisible, visible, width } from "../src/style";
import { C } from "../src/style";
import { colourInline, rowLines } from "../src/text";

const TRUE = "\x1b[38;2;204;146;214m", INDEXED = "\x1b[38;5;13m", BACK = "\x1b[38;5;7m";

test("a styled word longer than the row is cut after its visible cells, its colour carried into the rest", () => {
  for (const open of [TRUE, INDEXED]) {
    const [head, tail] = splitVisible(`${open}door/src/desk${BACK}`, 5);
    expect(head).toBe(`${open}door/`);
    expect(visible(tail)).toBe("src/desk");
    expect(tail.startsWith(open)).toBe(true);
  }
});

test("a colour opening right at the cut goes with the rest", () => {
  expect(splitVisible(`door/${TRUE}src`, 5)).toEqual(["door/", `${TRUE}src`]);
});

test("rowLines wraps a coloured path at its width, each row whole", () => {
  const rows = rowLines(`${TRUE}door/src/desk/builtin-tiles.ts:195${BACK}`, 25, Infinity, { hang: 0 });
  expect(rows.map(visible)).toEqual(["door/src/desk/builtin-til", "es.ts:195"]);
  for (const r of rows) expect(width(r)).toBeLessThanOrEqual(25);
});

// PIE-1524 (review): an expanded cell wraps its rest again on every row; carrying the colour history instead of the
// colour in effect multiplied the codes each pass (a 120-character path at 10 columns drew 1.57 MB and froze the door).
test("a long coloured path in an expanded 10-column cell stays small and fast", () => {
  const path = "door/src/desk/" + "builtin-tiles/".repeat(7) + "end.ts:195";
  const cell = colourInline("`" + path + "`", C.grey);
  const started = performance.now();
  const rows = rowLines(cell, 10, Infinity, { hang: 0 });
  expect(performance.now() - started).toBeLessThan(500);
  expect(rows.map(visible).join("")).toBe(path);
  for (const r of rows) expect(r.length).toBeLessThan(120);
});
