// PIE-941: a ::graph-* written without its --- lines is drawn as Markdown, so its props never arrive. One sentence, from
// outline-core, for every surface that lists or draws it. Fictional notes.
import { describe, expect, test } from "bun:test";
import { figureProps, figureSource, propsWithoutRules } from "../src/figure-props";
import { describeSyntaxWarnings, syntaxWarnings } from "../src/syntax-warnings";

const lines = (text: string) => text.split("\n");

describe("props written without their --- lines", () => {
  test("a body of only key: value lines is named, with the keys and where they go", () => {
    expect(propsWithoutRules("table", lines("query: type=errand\ncolumns: [title, created]"))).toBe(
      "the ::graph-table has query:, columns: but no --- lines: they are read as Markdown rows, not properties; put them between --- lines",
    );
    // A key whose value sits indented under it is still a key.
    expect(propsWithoutRules("table", lines("query: type=errand\ncolumns:\n  - title\n  - created"))).not.toBeNull();
  });

  test("a caption that happens to read key: value is a caption, and empty fences are fences", () => {
    expect(propsWithoutRules("decision", lines("Note: figures are provisional\n- **raised beds**: drains"))).toBeNull();
    expect(propsWithoutRules("decision", lines("Note: figures are provisional"))).toBeNull();
    const empty = figureSource(lines("---\n---\nquery: shown as text"));
    expect(figureProps("table", empty)).not.toHaveProperty("warning");
    expect(syntaxWarnings("::graph-table\n---\n---\nquery: x\n::")).toEqual([]);
  });

  test("a figure with its --- lines, or with real rows, or with nothing, says nothing", () => {
    expect(propsWithoutRules("table", lines("---\nquery: type=errand\n---"))).toBeNull();
    expect(propsWithoutRules("bar", lines("- Ana: 4\n- Bo: 6"))).toBeNull();
    expect(propsWithoutRules("bar", lines("Sown this week\n- Ana: 4"))).toBeNull();
    expect(propsWithoutRules("bar", lines(""))).toBeNull();
  });

  test("figureProps carries the warning beside what it drew, only while the YAML is empty", () => {
    const bare = figureSource(lines("query: type=errand\ncolumns: [title]"));
    expect(figureProps("table", bare)).toMatchObject({ warning: expect.stringContaining("no --- lines") });
    const ruled = figureSource(lines("---\nquery: type=errand\n---\nquery: shown as text"));
    expect("warning" in figureProps("table", ruled)).toBe(false);
  });

  test("syntaxWarnings lists it on the figure's line, once, with the closing line to hang a note on", () => {
    const text = "Plan\n\n::graph-table\nquery: type=errand\n::\n\n::graph-table\n---\nquery: type=errand\n---\n::";
    const found = syntaxWarnings(text);
    expect(found).toEqual([expect.objectContaining({ kind: "figure", line: 2, end: 4 })]);
    expect(found[0]!.message).toContain("(line 3)");
    expect(describeSyntaxWarnings(found)).toContain("put them between --- lines");
    // In a code fence it is only text.
    expect(syntaxWarnings("```\n::graph-table\nquery: x\n::\n```")).toEqual([]);
  });
});
