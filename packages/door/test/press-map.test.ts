// PIE-1530: a frame control is painted and recorded in one step, and a click finds the action it was drawn with.
// No desk, no scratch host: a Canvas, the press map and the corner's slots.
import { expect, test } from "bun:test";
import { Canvas } from "../src/canvas";
import { FRAME_GLYPHS } from "../src/desk/frame-controls";
import { cornerSlots, PressMap } from "../src/desk/press-map";

const plain = (s: string) => s.replace(/\x1b\[[^m]*m/g, "");
const tile = { col: 0, row: 0, cols: 40, rows: 6 };
const all = { closes: true, floats: true, menus: true, fold: true, hold: true, titleMode: true, lifts: true };

test("the corner's controls sit right to left and the title stops before them", () => {
  const at = cornerSlots(tile, all);
  expect([at.closeX, at.floatX, at.menuX, at.foldX, at.holdX, at.titleModeX, at.liftX]).toEqual([38, 36, 34, 32, 30, 23, 21]);
  expect(at.end).toBe(23);
  // Without a close or a float the menu takes the last cell before the corner; the title runs up to the menu.
  const bare = cornerSlots(tile, { ...all, closes: false, floats: false, fold: false, hold: false, titleMode: false, lifts: false });
  expect([bare.menuX, bare.end]).toEqual([37, 37]);
});

test("a control drawn into a Canvas is in the map with its action, and a click finds it on its tile only", () => {
  const canvas = new Canvas(40, 6), map = new PressMap(), at = cornerSlots(tile, all);
  map.draw(canvas, { kind: "close", id: 1, row: 0, from: at.closeX, to: at.closeX + 1, right: true, label: "close", action: "tile.close" }, FRAME_GLYPHS.close, "");
  map.draw(canvas, { kind: "fold", id: 1, row: 0, from: at.foldX, to: at.foldX + 1, right: true, label: "fold to a spine", action: "tile.collapse", args: { on: true }, alt: { action: "tile.collapse", args: { on: true, dir: "h" } }, altMods: 28 }, FRAME_GLYPHS.foldLeft, "");
  map.draw(canvas, { kind: "menu", id: 1, row: 0, from: at.menuX, to: at.menuX + 1, right: true, label: "menu", action: "tile.menu" }, FRAME_GLYPHS.menu, "");
  map.record({ kind: "title", id: 1, row: 0, from: 3, to: 9, label: "the title", action: "tile.title" });
  const row = plain(canvas.lines()[0]!);
  expect(row[at.closeX]).toBe(FRAME_GLYPHS.close);
  expect(row[at.foldX]).toBe(FRAME_GLYPHS.foldLeft);
  expect(map.at(at.closeX, 0, 1)).toMatchObject({ kind: "close", action: "tile.close" });
  expect(map.at(at.closeX, 0, 2)).toBeUndefined();                  // another tile on top there: not this one's
  expect(map.at(5, 0, 1)).toBeUndefined();                          // the title is a grip, not a press
  expect(map.at(at.menuX, 0, 1)).toBeUndefined();                   // the menu is asked before the tile under it
  expect(map.find("menu", at.menuX, 0)).toMatchObject({ id: 1, action: "tile.menu" });
  // A modifier the control names runs its alt.
  const fold = map.at(at.foldX, 0, 1)!;
  expect(map.choose(fold)).toEqual({ action: "tile.collapse", args: { on: true } });
  expect(map.choose(fold, 8)).toEqual({ action: "tile.collapse", args: { on: true, dir: "h" } });
  // x-ray reads the same entries: each control and what a click runs.
  expect(map.describe(1)).toEqual(["close: tile.close", "fold to a spine: tile.collapse on=true · alt+click tile.collapse on=true dir=h", "menu: tile.menu"]);
});

test("a float moved or sized since it was drawn takes its controls along, the corner's with its right edge", () => {
  const map = new PressMap();
  map.record({ kind: "float", id: 7, row: 2, from: 12, to: 15, label: "put it back", action: "tile.float" });
  map.record({ kind: "close", id: 7, row: 2, from: 38, to: 39, right: true, label: "close", action: "tile.close" });
  map.record({ kind: "close", id: 8, row: 0, from: 5, to: 6, right: true, label: "close", action: "tile.close" });
  map.move(7, { col: 10, row: 2, cols: 30, rows: 8 }, { col: 4, row: 5, cols: 40, rows: 8 });
  expect(map.on(7).map(p => [p.kind, p.row, p.from])).toEqual([["float", 5, 6], ["close", 5, 42]]);
  expect(map.on(8)[0]!.from).toBe(5);
  map.clear();
  expect(map.kind("close")).toEqual([]);
});
