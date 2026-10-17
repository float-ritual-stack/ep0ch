import { expect, test } from "bun:test";
import { outputRegionText } from "../src/output-region";
import { sourceCalls, withSlotProps, yamlParams } from "../src/sources";

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
  expect(withSlotProps("weekly:: for the shed week=1", { week: "2" })).toBe("weekly:: for the shed week=2");
  expect(withSlotProps("not a handler", { a: "b" })).toBeNull();
  expect(withSlotProps("x:: a=1", { a: "two\nlines" })).toBeNull();
});
