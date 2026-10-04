import { expect, test } from "bun:test";
import { componentBlockAt } from "../src/component-block";

test("a component block runs from its ::name line through its closing ::", () => {
  const figure = "::graph-stat\n---\ntitle: Open\n---\n::\n";
  expect(componentBlockAt(`${figure}\n## Next`)).toEqual({ name: "graph-stat", raw: figure });
  expect(componentBlockAt("::links\nfilter: x\n::")).toEqual({ name: "links", raw: "::links\nfilter: x\n::" });
});

test("an unclosed or one-line opener is not a component block", () => {
  expect(componentBlockAt("::graph-stat\n---\ntitle: Open")).toBeNull();
  expect(componentBlockAt("text\n::graph-stat\n::")).toBeNull();
  expect(componentBlockAt("    ::graph-stat\n    ::")).toBeNull();
});

test("an opener with arguments is one line, or closes before a blank line", () => {
  expect(componentBlockAt("::links ((abc))\n\nmore\n::")).toEqual({ name: "links", raw: "::links ((abc))\n" });
  expect(componentBlockAt("::links ((abc))")).toEqual({ name: "links", raw: "::links ((abc))" });
  expect(componentBlockAt("::links garden\ntitle: x\n::\nafter")).toEqual({ name: "links", raw: "::links garden\ntitle: x\n::\n" });
});
