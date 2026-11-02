import { expect, test } from "bun:test";
import { isStyleKey, stylingTokensInLine, withoutStylingTokens, withoutTokens, liveTokensInLine, BASE_HEADING_STYLE, BUILTIN_HEADING_STYLE_REGISTRY, headingStyleDeclaration, headingStyleRegistry, headingStylesFromBlocks, headingStyleWith, styledLine } from "../src/heading-styles";

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

test("taking tokens out keeps the words apart, and a token in a code span is text (codex review)", () => {
  expect(styledLine("## A [heading::dots]B [heading-rows::1]")!.text).toBe("## A B");
  expect(styledLine("## Example `[heading-tone::amber]`")).toEqual({ kind: "heading", level: 2, style: null, fields: [], text: "## Example `[heading-tone::amber]`" });
  expect(headingStyleDeclaration("Example `[heading-tone::amber]` [heading-style::plot]")).toMatchObject({ style: { tone: "neutral" }, text: "Example `[heading-tone::amber]`" });
  const line = "a [x::1] b `[y::2]`";
  expect(withoutTokens(line, liveTokensInLine(line))).toBe("a b `[y::2]`");
});

test("heading-margin: columns, rows and columns, or top, columns and bottom; out of range is said and clamped", () => {
  const m = (v: string) => headingStyleWith(BASE_HEADING_STYLE, [{ key: "heading-margin", value: v }]);
  expect(m("6").style.margin).toEqual({ top: 0, cols: 6, bottom: 0 });
  expect(m("1 12").style.margin).toEqual({ top: 1, cols: 12, bottom: 1 });
  expect(m("2 0 1")).toEqual({ style: expect.objectContaining({ margin: { top: 2, cols: 0, bottom: 1 } }), problems: [] });
  expect(m("9 0 1").style.margin).toEqual({ top: 3, cols: 0, bottom: 1 });
  expect(m("9 0 1").problems).toEqual([expect.stringContaining("at most 3 rows")]);
  expect(m("1 2 3 4").problems).toEqual([expect.stringContaining("top columns bottom")]);
});

test("PIE-1510: a styling property isn't content: style.* anywhere, heading-* on a heading, leave the drawn text; words and other properties stay", () => {
  expect(stylingTokensInLine("- clover [style.list.gap::2] [who::sam] [style.list.zebra::on]").map(t => t.key)).toEqual(["style.list.gap", "style.list.zebra"]);
  expect(withoutStylingTokens("- clover [style.list.gap::2] [who::sam] [style.list.zebra::on]")).toBe("- clover [who::sam]");
  expect(withoutStylingTokens("Herbs: [style.list.zebra::on]")).toBe("Herbs:");
  expect(withoutStylingTokens("## Climbers [heading-pattern::dots] [style.list.divider::dots] [heading::band]")).toBe("## Climbers");
  // On a list item a heading field is words; a rule's token is the renderer's (a --- under a paragraph is no rule).
  expect(withoutStylingTokens("- odd [heading-rows::2]")).toBe("- odd [heading-rows::2]");
  expect(withoutStylingTokens("--- [rule::fade]")).toBe("--- [rule::fade]");
  // A rule names its style with `rule`, never `heading`: `--- [heading::band]` is text, as before (CodeRabbit, #1193).
  expect(styledLine("--- [heading::band]")).toBeNull();
  expect(withoutStylingTokens("--- [heading::band]")).toBe("--- [heading::band]");
  // An item that is only its tokens stays an item: its marker keeps its space.
  expect(withoutStylingTokens("- [style.list.zebra::on]")).toBe("- ");
  expect(withoutStylingTokens("  1. [style.list.gap::1]")).toBe("  1. ");
  // A retired key and a width's are style keys too; a token in a code span is text.
  expect(withoutStylingTokens("A [style.wide.pad::2] [style.header.image::x.png] B")).toBe("A B");
  expect(withoutStylingTokens("type `[style.list.gap::1]` on the first item")).toBe("type `[style.list.gap::1]` on the first item");
  expect(isStyleKey("style.list.gap")).toBe(true); expect(isStyleKey("styled")).toBe(false);
  // styledLine's text and fields follow the same rule: style.* leaves a heading's text, and isn't a heading field.
  expect(styledLine("## Climbers [heading-tone::amber] [style.list.gap::2]")).toEqual({ kind: "heading", level: 2, style: null, fields: [{ key: "heading-tone", value: "amber" }], text: "## Climbers" });
});
