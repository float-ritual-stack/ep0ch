import { expect, test } from "bun:test";
import { componentBlockAt, componentBlocks } from "../src/component-block";
import { COMARK_NOTE, COMARK_NOTE_BLOCKS } from "./fixtures/component-notes";
import * as modCopy from "../../claude-mod/hooks/component-block";

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

test("an unclosed component never swallows a heading; a # inside its YAML or a code fence is not one", () => {
  expect(componentBlockAt("::graph-stat\n## Heading\ntext\n\n## Two\n::\n")).toBeNull();
  const yaml = "::graph-stat\n---\n# a comment\ntitle: x\n---\n::\n";
  expect(componentBlockAt(`${yaml}## After`)).toEqual({ name: "graph-stat", raw: yaml });
  const code = "::graph-annotate\n```sh\n# (1) close the tap\n```\n1. the tap\n::\n";
  expect(componentBlockAt(code)).toEqual({ name: "graph-annotate", raw: code });
});

test("a code fence closes only on its own character, at least as long, so a ~~~ inside ``` keeps the figure whole", () => {
  const mixed = "::graph-annotate\n```sh\n~~~\n# (1) close the tap\n```\n1. the tap\n::\n";
  expect(componentBlockAt(`${mixed}## After`)).toEqual({ name: "graph-annotate", raw: mixed });
  const tilde = "::graph-annotate\n~~~~\n```\n~~~\n# still code\n~~~~\n::\n";
  expect(componentBlockAt(tilde)).toEqual({ name: "graph-annotate", raw: tilde });
  // A closing fence takes no info string.
  const info = "::graph-annotate\n```\n```sh\n# still code\n```\n::\n";
  expect(componentBlockAt(info)).toEqual({ name: "graph-annotate", raw: info });
});

test("componentBlocks: a bare :: inside a figure's code fence doesn't close it; a heading then a second figure", () => {
  expect(componentBlocks(COMARK_NOTE)).toEqual(COMARK_NOTE_BLOCKS);
});

test("componentBlocks: a figure inside a code fence is the code's text; an unclosed opener is plain; one-line args", () => {
  expect(componentBlocks(["```", "::graph-stat", "::", "```", "::links", "::"])).toEqual([{ name: "links", args: null, start: 4, end: 5 }]);
  expect(componentBlocks(["::graph-stat", "## Heading", "::graph-rank", "- a: 1", "::"])).toEqual([{ name: "graph-rank", args: null, start: 2, end: 4 }]);
  expect(componentBlocks(["::resources jira", "", "::links ((abc))"])).toEqual([
    { name: "resources", args: "jira", start: 0, end: 0 },
    { name: "links", args: "((abc))", start: 2, end: 2 },
  ]);
});

test("the Claude mod's copy (a hooks module can't import outside its plugin) stays this file, and answers the same", async () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
  const [own, copy] = await Promise.all([read("../src/component-block.ts"), read("../../claude-mod/hooks/component-block.ts")]);
  expect(copy.slice(copy.indexOf("\n") + 1)).toBe(own);
  expect(modCopy.componentBlocks(COMARK_NOTE)).toEqual(componentBlocks(COMARK_NOTE));
});
