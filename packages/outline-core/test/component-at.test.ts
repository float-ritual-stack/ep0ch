// `componentAt`: which component a line of a note starts, one answer for every reader of a note.
import { expect, test } from "bun:test";
import { componentAt, componentStarts } from "../src/component-at";

const NOTE = [
  "Bed plan [type::plan]",              // 0
  "Sow after the frost.",               // 1
  "::links{query=\"type=bed\"}",        // 2
  "::",                                 // 3
  "::graph-stat",                       // 4
  "- beds: 4",                          // 5
  "::",                                 // 6
  "::graph-table",                      // 7
  "---",                                // 8
  "query: type=bed",                    // 9
  "---",                                // 10
  "::",                                 // 11
  "::view{query=\"type=seed\"}",        // 12
  "::button{label=\"Sow\" act=\"note.new\"}", // 13
  "- ::button{label=\"Water\" act=\"note.new\"}", // 14
  "::use{of=[[bed-card]] bed=north}",   // 15
  "::fields{key=sown}",                 // 16
  "::if{this=\"type=plan\"}",           // 17
  "Only on a plan.",                    // 18
  "::",                                 // 19
  "::box{pad.x=1}",                     // 20
  "::graph-meter",                      // 21
  "- north: 3",                         // 22
  "::",                                 // 23
  "::",                                 // 24
  "::trellis",                          // 25
  "nobody knows this one",              // 26
  "::",                                 // 27
  "```",                                // 28
  "::graph-stat",                       // 29
  "```",                                // 30
];

test("each line that starts a component says which, and where it ends", () => {
  const starts = componentStarts(NOTE);
  const found = NOTE.flatMap((_, i) => { const c = componentAt(NOTE, i, starts); return c ? [[i, c.kind, c.end] as const] : []; });
  expect(found).toEqual([
    [2, "links", 3], [4, "figure", 6], [7, "view", 11], [12, "view", 12], [13, "button", 13], [14, "button", 14], [15, "use", 15], [16, "fields", 16], [17, "if", 19],
    [20, "box", 24], [21, "figure", 23], [25, "component", 27],
  ]);
});

test("a figure says its kind, a button its call, and a button inside a list item says its item's mark", () => {
  expect(componentAt(NOTE, 4)).toMatchObject({ kind: "figure", figure: "stat" });
  expect(componentAt(NOTE, 13)).toMatchObject({ kind: "button", call: { label: "Sow", act: "note.new" } });
  expect(componentAt(NOTE, 14)).toMatchObject({ kind: "button", call: { label: "Water", prefix: "- " } });
  // An opener inside a code fence is the code's text.
  expect(componentAt(NOTE, 29)).toBeNull();
  // A graph-table with rows of its own is a figure; with a query it is a collection.
  expect(componentAt(["::graph-table", "- a | b", "::"], 0)).toMatchObject({ kind: "figure", figure: "table" });
});
