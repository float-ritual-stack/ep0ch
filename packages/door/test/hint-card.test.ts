import { describe, expect, test } from "bun:test";
import { Canvas } from "../src/canvas";
import { GATHER_HINT, HintCard } from "../src/surface/hint-card";
import { itemBar, visible } from "../src/style";

// Evan, Oct 20 8:52 PM: "this tool tip is playing cat and mouse with my cursor". A card is placed once, out from
// under the control just pressed, and then stays where it is while the pointer moves, into it or anywhere else.
describe("a hint card stays where it was placed", () => {
  const area = { col: 0, row: 0, cols: 120, rows: 40 }, anchor = { col: 10, row: 5, cols: 50, rows: 20 };
  const draw = (card: HintCard, pointer?: { x: number; y: number }) => card.draw(new Canvas(120, 40), anchor, area, false, pointer);

  test("a pointer moving across the card never moves it", () => {
    const card = new HintCard(GATHER_HINT, "links", 1);
    const first = draw(card, { x: 100, y: 30 });
    for (const [dx, dy] of [[2, 1], [10, 2], [20, 3], [5, 4]] as const) expect(draw(card, { x: first.col + dx, y: first.row + dy })).toEqual(first);
  });

  test("it opens clear of the pointer that opened it, then holds that place", () => {
    const card = new HintCard(GATHER_HINT, "links", 1);
    const opened = draw(card, { x: 14, y: 7 });
    expect(14 >= opened.col && 14 < opened.col + opened.cols && 7 >= opened.row && 7 < opened.row + opened.rows).toBe(false);
    expect(draw(card, { x: opened.col + 3, y: opened.row + 1 })).toEqual(opened);
    expect(draw(card, { x: 14, y: 7 })).toEqual(opened);
  });

  test("a new anchor or room places it again", () => {
    const card = new HintCard(GATHER_HINT, "links", 1);
    const first = draw(card);
    const moved = card.draw(new Canvas(120, 40), { col: 40, row: 12, cols: 50, rows: 20 }, area, false);
    expect(moved).not.toEqual(first);
  });
});

// Evan, Oct 20 9:42 PM, on the wire card: "making the line of the one you are changing more noticeable, like how we
// indicate the selected line on a table": the current choice is drawn as a selected row, its marker and band.
test("the choice that is the state now is drawn as a selected row", () => {
  const card = new HintCard({ title: "detail: open wire", lines: ["An open from detail lands in itself."], choices: [
    { label: "change select wire", key: "s", act: { action: "tile.link" } },
    { label: "change open wire", key: "o", current: true, act: { action: "tile.link" } },
  ] }, "detail", 1);
  const canvas = new Canvas(120, 40);
  card.draw(canvas, { col: 10, row: 5, cols: 50, rows: 20 }, { col: 0, row: 0, cols: 120, rows: 40 }, false);
  const rows = canvas.lines();
  const current = rows.find(r => visible(r).includes("change open wire"))!, other = rows.find(r => visible(r).includes("change select wire"))!;
  expect(current).toContain(itemBar());
  expect(other).not.toContain(itemBar());
});
