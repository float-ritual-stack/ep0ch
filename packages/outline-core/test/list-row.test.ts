// The list primitive's rows (ADR 0004 contract 3): the one activation a row carries and the one matcher a typed filter uses.
import { expect, test } from "bun:test";
import { activationCount, activationOf, filterListRows, listRowMatches, type ListRow, actOf } from "../src/list-row";

const ROWS: ListRow[] = [
  { id: "g1", label: "Seeds", group: "garden" },
  { id: "a", label: "Pea trellis", detail: "next", group: "garden", do: { open: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" } },
  { id: "b", label: "Compost log", detail: "waiting", group: "garden", do: { copy: "compost" } },
  { id: "g2", label: "Tools", group: "shed" },
  { id: "c", label: "Spade", group: "shed", do: { run: { action: "tile.zoom", args: { name: "spade" } } } },
];

test("a row does exactly one thing: its activation, or none for a header", () => {
  expect(activationOf(ROWS[1]!)).toEqual({ kind: "open", value: "7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34" });
  expect(activationOf(ROWS[4]!)).toEqual({ kind: "run", value: { action: "tile.zoom", args: { name: "spade" } } });
  expect(activationOf(ROWS[0]!)).toBeNull();
  expect(activationCount({ open: "x", copy: "y" })).toBe(2);
  expect(activationCount({ insert: "z" })).toBe(1);
});

test("the typed filter is the search matcher over label, detail and mark; a header stays while a row of its group does", () => {
  expect(listRowMatches(ROWS[1]!, "trellis")).toBe(true);
  expect(listRowMatches(ROWS[1]!, "waiting")).toBe(false);
  expect(listRowMatches(ROWS[2]!, "waiting")).toBe(true);
  expect(listRowMatches(ROWS[2]!, "")).toBe(true);
  expect(filterListRows(ROWS, "spade").map(r => r.id)).toEqual(["g2", "c"]);
  expect(filterListRows(ROWS, "trellis").map(r => r.id)).toEqual(["g1", "a"]);
  expect(filterListRows(ROWS, "nothing like this at all").map(r => r.id)).toEqual([]);
  expect(filterListRows(ROWS, "  ")).toHaveLength(ROWS.length);
});

test("a row's act line is its activation said as a line: an open, a run with its arguments, and none for a copy or an insert", () => {
  expect(actOf({ open: "north-bed" })).toBe('open id="north-bed"');
  expect(actOf({ open: { ref: "north-bed", where: "beside" } })).toBe('open id="north-bed"');
  expect(actOf({ run: { action: "screen.open", args: { name: "garden-work" } } })).toBe('screen.open name="garden-work"');
  expect(actOf({ run: { action: "facets.set", args: { key: "crop", value: "runner beans" } } })).toBe('facets.set key="crop" value="runner beans"');
  expect(actOf({ run: { action: "bar.open" } })).toBe("bar.open");
  expect(actOf({ copy: "north-bed" })).toBeUndefined();
  expect(actOf({ insert: "((north-bed))" })).toBeUndefined();
  expect(actOf(undefined)).toBeUndefined();
});
