import { describe, expect, test } from "bun:test";
import { dropAt, handleDrop, type DropTile } from "../src/desk/drop";

describe("drop zones in cells (bands and the layout's outer edges)", () => {
  const area = { col: 0, row: 0, cols: 120, rows: 40 };
  const tiles: DropTile<string>[] = [
    { id: "a", rect: { col: 0, row: 0, cols: 60, rows: 40 } },
    { id: "b", rect: { col: 60, row: 0, cols: 60, rows: 20 }, tabs: [{ id: "b", from: 62, to: 70 }, { id: "x", from: 71, to: 80 }] },
    { id: "c", rect: { col: 60, row: 20, cols: 60, rows: 20 } },
  ];
  const at = (x: number, y: number, src = "c") => { const d = dropAt(tiles, area, x, y, src); return d && { kind: d.kind, target: (d as any).target, dir: (d as any).dir, index: (d as any).index }; };
  test("the upper centre and the header make tabs; over a tab's label it goes before that tab", () => {
    expect(at(30, 15)).toMatchObject({ kind: "tabs", target: "a" });
    expect(at(30, 0)).toMatchObject({ kind: "tabs", target: "a", index: 1 });
    expect(at(65, 0)).toMatchObject({ kind: "tabs", target: "b", index: 0 });
    expect(at(75, 0)).toMatchObject({ kind: "tabs", target: "b", index: 1 });
    expect(at(100, 0)).toMatchObject({ kind: "tabs", target: "b", index: 2 });
  });
  test("the four bands split where drawn, including their corners", () => {
    expect(at(5, 20)).toMatchObject({ kind: "split", target: "a", dir: "left" });
    expect(at(55, 20)).toMatchObject({ kind: "split", target: "a", dir: "right" });
    expect(at(30, 3)).toMatchObject({ kind: "split", target: "a", dir: "up" });
    expect(at(30, 37)).toMatchObject({ kind: "split", target: "a", dir: "down" });
    // The top band spans the full width, including its corners.
    expect(at(8, 2)).toMatchObject({ dir: "up" });
    expect(at(4, 6)).toMatchObject({ dir: "up" });
  });
  test("the outer strips win over a tile: left and right columns, the bottom row", () => {
    expect(at(0, 20)).toMatchObject({ kind: "edge", dir: "left" });
    expect(at(1, 20)).toMatchObject({ kind: "edge", dir: "left" });
    expect(at(119, 5)).toMatchObject({ kind: "edge", dir: "right" });
    expect(at(30, 39)).toMatchObject({ kind: "edge", dir: "down" });
    expect(dropAt([tiles[0]!], area, 0, 20, "a")).toBeNull();
  });
  test("onto itself: nothing, unless it's a tab in a set (its centre means nothing; its sides take it out)", () => {
    expect(at(90, 30, "c")).toBeNull();
    expect(at(90, 20, "c")).toBeNull();
    expect(at(90, 10, "x")).toBeNull();
    expect(at(64, 10, "x")).toMatchObject({ kind: "split", target: "b", dir: "left" });
    expect(at(65, 0, "x")).toMatchObject({ kind: "tabs", target: "b", index: 0 });
  });
  test("the lower middle swaps, with its own band instead of the whole tile", () => {
    expect(at(30, 23)).toMatchObject({ kind: "swap", target: "a" });
    const g = dropAt(tiles, area, 30, 23, "c")!.ghost;
    expect(g.row).toBeGreaterThan(15);
    expect(g.row + g.rows).toBeLessThan(37);
    expect(dropAt(tiles, area, 119, 20, "c")!.ghost).toEqual({ col: 84, row: 0, cols: 36, rows: 40 });
  });
});

describe("drops and policy (PIE-505)", () => {
  const area = { col: 0, row: 0, cols: 100, rows: 30 };
  const tiles = [{ id: "a", rect: { col: 0, row: 0, cols: 50, rows: 30 } }, { id: "b", rect: { col: 50, row: 0, cols: 50, rows: 30 } }];
  test("a drop carries the reason policy refuses it; one it takes carries none", () => {
    const refuse = (to: any) => (to.kind === "tabs" && to.target === "b" ? "b takes no drops (droppable off)" : null);
    expect(dropAt(tiles, area, 75, 12, "a", true, refuse)).toMatchObject({ kind: "tabs", target: "b", refused: "b takes no drops (droppable off)" });
    expect(dropAt(tiles, area, 60, 15, "a", true, refuse)!.refused).toBeUndefined();
  });
  test("a shut dock's handle on the hint row takes a tile into the tabs of what it shows", () => {
    const handles = [{ from: 80, to: 88, row: 30, shows: "t", edge: "left" as const }];
    expect(handleDrop(handles, area, 82, 30, "a")).toMatchObject({ kind: "tabs", target: "t", label: "\u2190 docked here: stays on this screen" });
    expect(handleDrop(handles, area, 82, 29, "a")).toBeNull();
    expect(handleDrop(handles, area, 82, 30, "t")).toBeNull();     // onto itself means nothing
  });
});
