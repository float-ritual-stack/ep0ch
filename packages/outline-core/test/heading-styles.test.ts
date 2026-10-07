import { expect, test } from "bun:test";
import { BASE_HEADING_STYLE, BUILTIN_HEADING_STYLE_REGISTRY, headingStyleDeclaration, headingStyleRegistry, headingStylesFromBlocks, headingStyleWith, styledLine } from "../src/heading-styles";

test("styledLine: a heading's or a rule's style, and the line without it; anything else is null", () => {
  expect(styledLine("## Your calls [heading::Band]")).toEqual({ kind: "heading", level: 2, style: "band", fields: [], text: "## Your calls" });
  expect(styledLine("## Your calls [heading::band] [who::sam]")).toEqual({ kind: "heading", level: 2, style: "band", fields: [], text: "## Your calls [who::sam]" });
  expect(styledLine("# Plan")).toEqual({ kind: "heading", level: 1, style: null, fields: [], text: "# Plan" });
  expect(styledLine("--- [rule::fade]")).toEqual({ kind: "rule", level: 0, style: "fade", fields: [], text: "---" });
  expect(styledLine("* * *")).toEqual({ kind: "rule", level: 0, style: null, fields: [], text: "* * *" });
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

test("a heading's own fields restyle it alone and leave its text; any other token stays, whole (Oct 7 screenshot)", () => {
  expect(styledLine("## Odd jobs [heading::dots] [heading-tone::amber]")).toEqual({
    kind: "heading", level: 2, style: "dots", fields: [{ key: "heading-tone", value: "amber" }], text: "## Odd jobs",
  });
  expect(styledLine("## Odd jobs [heading-pattern::dots] [who::sam] [heading-rows::1]")).toEqual({
    kind: "heading", level: 2, style: null, fields: [{ key: "heading-pattern", value: "dots" }, { key: "heading-rows", value: "1" }], text: "## Odd jobs [who::sam]",
  });
  expect(styledLine("--- [heading-pattern::dots]")).toMatchObject({ kind: "rule", style: null, text: "---", fields: [{ key: "heading-pattern", value: "dots" }] });
  const dots = BUILTIN_HEADING_STYLE_REGISTRY.style("dots")!;
  expect(headingStyleWith(dots, [{ key: "heading-tone", value: "amber" }]).style).toMatchObject({ name: "dots", pattern: "dots", tone: "amber" });
  expect(dots.tone).toBe("neutral");
  expect(headingStyleWith(BASE_HEADING_STYLE, [{ key: "heading-rows", value: "9" }])).toMatchObject({ style: { rows: 3 }, problems: [expect.stringContaining("heading-rows")] });
});

test("a line anywhere declares a style with its own tokens; a code span declares nothing; a declaring line is no styled heading", () => {
  const line = "# Plot style [heading-style::plot] [heading-pattern::dots] [heading-rows::2] [heading-align::left] [heading-row::top] [heading-tone::amber]";
  expect(headingStyleDeclaration(line)).toMatchObject({
    style: { name: "plot", pattern: "dots", rows: 2, align: "left", row: "top", tone: "amber" }, problems: [], text: "# Plot style",
  });
  expect(styledLine(line)).toBeNull();
  expect(headingStyleDeclaration("Write `[heading-style::plot]` on a line")).toBeNull();
  expect(headingStyleDeclaration("[heading-style::plot] [heading-pattern::zigzag]")!.problems).toEqual([expect.stringContaining('heading-pattern "zigzag"')]);
  expect(headingStylesFromBlocks([{ id: "aaaaaaaa-1", line: 4, properties: [{ key: "heading-style", value: "x y" }] }]).problems).toEqual([expect.stringContaining("note aaaaaaaa line 5")]);
});
