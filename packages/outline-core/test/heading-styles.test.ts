import { expect, test } from "bun:test";
import { BUILTIN_HEADING_STYLE_REGISTRY, headingStyleRegistry, headingStylesFromBlocks, styledLine } from "../src/heading-styles";

test("styledLine: a heading's or a rule's style, and the line without it; anything else is null", () => {
  expect(styledLine("## Your calls [heading::Band]")).toEqual({ kind: "heading", level: 2, style: "band", text: "## Your calls" });
  expect(styledLine("## Your calls [heading::band] [who::sam]")).toEqual({ kind: "heading", level: 2, style: "band", text: "## Your calls [who::sam]" });
  expect(styledLine("# Plan")).toEqual({ kind: "heading", level: 1, style: null, text: "# Plan" });
  expect(styledLine("--- [rule::fade]")).toEqual({ kind: "rule", level: 0, style: "fade", text: "---" });
  expect(styledLine("* * *")).toEqual({ kind: "rule", level: 0, style: null, text: "* * *" });
  expect(styledLine("--- not a rule")).toBeNull();
  expect(styledLine("Beds [heading::band]")).toBeNull();
  expect(styledLine("#hashtag")).toBeNull();
});

test("the registry: the built-ins, a declared style restyling one, levels' and rules' defaults", () => {
  expect(BUILTIN_HEADING_STYLE_REGISTRY.style("band")).toMatchObject({ pattern: "stack", rows: 3, align: "center" });
  expect(BUILTIN_HEADING_STYLE_REGISTRY.forLevel(1)).toBeNull();
  expect(BUILTIN_HEADING_STYLE_REGISTRY.forRule()).toBeNull();
  const { styles, problems } = headingStylesFromBlocks([
    { id: "aaaaaaaa", properties: [{ key: "heading-style", value: "band" }, { key: "heading-tone", value: "amber" }, { key: "heading-default", value: "1" }] },
    { id: "bbbbbbbb", properties: [{ key: "heading-style", value: "quiet" }, { key: "heading-pattern", value: "rule" }, { key: "heading-rows", value: "1" }, { key: "heading-default", value: "rule" }] },
    { id: "cccccccc", properties: [{ key: "heading-style", value: "no good!" }] },
  ]);
  const reg = headingStyleRegistry(styles);
  // A restyled built-in keeps what it isn't told.
  expect(reg.style("BAND")).toMatchObject({ pattern: "stack", letters: "spaced", tone: "amber", block: "aaaaaaaa" });
  expect(reg.forLevel(1)?.name).toBe("band");
  expect(reg.forLevel(2)).toBeNull();
  expect(reg.forRule()).toMatchObject({ name: "quiet", rows: 1 });
  expect(problems).toEqual([expect.stringContaining("isn't a name")]);
});
