// One page step (PIE-1293): PgUp PgDn move the rows shown less one everywhere: a list's cursor (listMove, RowView,
// ListView) and a reader's or a preview's scroll (pageRows).
import { describe, expect, test } from "bun:test";
import { listMove, pageRows, RowView } from "../src/scroll";
import { ListView } from "../src/surface/list-view";

describe("the page step", () => {
  test("a page is the rows shown less one, at least one", () => {
    expect(pageRows(20)).toBe(19);
    expect(pageRows(1)).toBe(1);
    expect(pageRows(0)).toBe(1);
  });
  test("listMove: a row, a page, the ends; null for any other key", () => {
    const o = { at: 5, n: 100, room: 11 };
    expect(listMove({ kind: "down" }, o)).toBe(6);
    expect(listMove({ kind: "char", ch: "k" }, o)).toBe(4);
    expect(listMove({ kind: "pgdn" }, o)).toBe(15);
    expect(listMove({ kind: "pgup" }, o)).toBe(0);
    expect(listMove({ kind: "end" }, o)).toBe(99);
    expect(listMove({ kind: "home" }, o)).toBe(0);
    expect(listMove({ kind: "char", ch: "x" }, o)).toBeNull();
    expect(listMove({ kind: "char", ch: "j", ctrl: true }, o)).toBeNull();
    expect(listMove({ kind: "pgdn" }, { at: 0, n: 0, room: 10 })).toBe(0);
  });
  test("RowView.page: the rows it was placed in, less one", () => {
    const v = new RowView();
    v.place(0, 100, 12);
    expect(v.page(1)).toBe(11);
    expect(v.page(-1)).toBe(-11);
  });
  test("ListView: PgDn moves the pick the rows it drew, less one", () => {
    const l = new ListView("t");
    l.set(Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, label: `row ${i}` })));
    const drawn = l.draw({ cols: 30, room: 8, focused: true, selection: true } as any);
    const shown = new Set(drawn.rowAt.filter(r => r !== null)).size;
    expect(l.pageBy(1)).toBe(pageRows(shown));
  });
  test.each(["table", "grid", "rows"] as const)("ListView: PgDn in a %s collection moves the rows it shows less one, not one row", arrange => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, label: `row ${i}`, cells: [`row ${i}`], do: { open: `r${i}` } }));
    const l = new ListView("t");
    l.set(rows);
    l.draw({ cols: 80, room: 20, focused: true, selection: true, primitive: { type: "list", rows, arrange, columns: ["title"] } } as any);
    expect(l.pageBy(1)).toBeGreaterThan(1);
  });
});
