import { expect, test } from "bun:test";
import { outputRegionText } from "../src/output-region";
import { slotArgument, sourceCalls, withSlotProps, yamlParams } from "../src/sources";

test("a note's own generated lines are found in order: ::use, ::fields, ::if , a figure, a written region (PIE-956)", () => {
  const region = outputRegionText({ label: "rota", producer: "p1", anchor: "out-rota-1", body: "- Mon" });
  const text = ["Plot", "", "::use{of=[[meeting]] who=Kit}", "::fields{key=crop}", '::if{where="owner=sam"}', "inside", "::", "::graph-table", "---", "query: crop=beans", "limit: 5", "---", "::", region].join("\n");
  const calls = sourceCalls(text);
  expect(calls.map(c => [c.kind, c.line, c.name])).toEqual([["use", 2, "::use [[meeting]]"], ["fields", 3, "::fields crop"], ["if", 4, "::if"], ["figure", 7, "graph-table"], ["output", 13, "rota"]]);
  expect(calls[0]!.params).toEqual([{ key: "who", value: "Kit" }]);
  expect(yamlParams(calls[3]!.figure!.yaml)).toEqual([{ key: "query", value: "crop=beans" }, { key: "limit", value: "5" }]);
});

test("a code fence's generated-looking lines are code, and a region's inside lines are its own", () => {
  const text = "Doc\n\n```\n::use{of=[[x]]}\n```\n\n> [!output]- r [output-of::((p))] ^out-r-1\n> ::use{of=[[y]]}";
  expect(sourceCalls(text).map(c => c.kind)).toEqual(["output"]);
});

test("slot words are rewritten in place: a changed value, an added one, a quoted one; the rest of the line stays", () => {
  expect(withSlotProps("beds-table:: week=42", { week: "43" })).toBe("beds-table:: week=43");
  expect(withSlotProps("beds-table:: week=42 crop=beans", { crop: "peas and kale" })).toBe('beds-table:: week=42 crop="peas and kale"');
  expect(withSlotProps("beds-table::", { week: "7" })).toBe("beds-table:: week=7");
  // A component call with an anchor after its brace keeps the anchor and still reads its props.
  expect(slotArgument('::count{where="type=parcel"} ^parcels')).toBe('where="type=parcel"');
  expect(withSlotProps('::count{where="type=parcel"} ^parcels', { where: "bed" })).toBe('::count{where=bed} ^parcels');
  // A note component's call is the same line in its other spelling: its slots are written inside the braces.
  expect(withSlotProps('::board{where="type=errand" group=owner}', { group: "status" })).toBe('::board{where="type=errand" group=status}');
  expect(withSlotProps("::board{}", { group: "status" })).toBe("::board{group=status}");
  expect(slotArgument('::board{where="type=errand" group=owner}')).toBe('where="type=errand" group=owner');
  expect(slotArgument("weekly:: week=1")).toBe("week=1");
  expect(withSlotProps("weekly:: for the shed week=1", { week: "2" })).toBe("weekly:: for the shed week=2");
  expect(withSlotProps("not a handler", { a: "b" })).toBeNull();
  expect(withSlotProps("x:: a=1", { a: "two\nlines" })).toBeNull();
});

test("editing one slot leaves quoted words and spacing alone, and only the first of a repeated name", () => {
  expect(withSlotProps('x:: title="two  spaces" week=1', { week: "2" })).toBe('x:: title="two  spaces" week=2');
  expect(withSlotProps("x:: tag=a tag=b", { tag: "c" })).toBe("x:: tag=c tag=b");
});

test("code inside a component's body is still code", () => {
  const text = 'Note\n::if{where="x=y"}\n```\n::use{of=[[fake]]}\n```\n::';
  expect(sourceCalls(text).map(c => c.kind)).toEqual(["if"]);
});
