import { describe, expect, test } from "bun:test";
import { expandRuns, figureRow, MAX_RUN, numbersOf, parseFigureMarkdown, unwrapEmphasis } from "../src/figure-markdown";

describe("a figure's Markdown", () => {
  test("bold is strong and italic is em, around the whole row, its label or its value", () => {
    expect(figureRow("**launch**").emphasis).toBe("strong");
    expect(figureRow("*maybe later*").emphasis).toBe("em");
    expect(figureRow("_maybe later_").emphasis).toBe("em");
    expect(figureRow("**2026-03**: dig over")).toMatchObject({ label: "2026-03", value: "dig over", emphasis: "strong" });
    expect(figureRow("loki: *brb, kettle*")).toMatchObject({ label: "loki", value: "brb, kettle", emphasis: "em" });
    expect(figureRow("plain").emphasis).toBeNull();
    // Two spans are not one around the whole; a row that starts with one is marked as it is.
    expect(unwrapEmphasis("**a** and **b**").emphasis).toBeNull();
    expect(figureRow("**a** and b")).toMatchObject({ text: "a and b", emphasis: "strong" });
    expect(figureRow("*a* and b")).toMatchObject({ text: "a and b", emphasis: "em" });
    expect(figureRow("a and **b**").emphasis).toBeNull();
    expect(unwrapEmphasis("*a* and *b*").emphasis).toBeNull();
  });

  test("a label is everything before the first `: `; a time's colon is not one", () => {
    expect(figureRow("09:30: standup")).toMatchObject({ label: "09:30", value: "standup" });
    expect(figureRow("ctrl+k: open the palette: anywhere")).toMatchObject({ label: "ctrl+k", value: "open the palette: anywhere" });
    expect(figureRow("see https://example.org/x")).toMatchObject({ label: null, value: "see https://example.org/x" });
  });

  test("a side note after an em dash, a path, a box", () => {
    expect(figureRow("Bun workspaces — one lockfile")).toMatchObject({ text: "Bun workspaces", note: "one lockfile" });
    expect(figureRow("*pnpm* — two tools for one job")).toMatchObject({ text: "pnpm", emphasis: "em", note: "two tools for one job" });
    expect(figureRow("route: inbox → triage → done").path).toEqual(["inbox", "triage", "done"]);
    expect(figureRow("a -> b").path).toEqual(["a", "b"]);
    expect(figureRow("a well-made -> nothing ->").path).toBeNull();
    expect(figureRow("[x] freeze tokens").done).toBe(true);
    expect(figureRow("[ ] write it up").done).toBe(false);
    expect(figureRow("write it up").done).toBeNull();
  });

  test("runs spell out in any list of values", () => {
    expect(expandRuns("0 1 4 2 0*3")).toEqual(["0", "1", "4", "2", "0", "0", "0"]);
    expect(expandRuns("ok*3, down, degraded*2")).toEqual(["ok", "ok", "ok", "down", "degraded", "degraded"]);
    expect(expandRuns("ok*99999").length).toBe(MAX_RUN);
    expect(numbersOf(figureRow("2026-03-02: 0 1 x*2 3"))).toEqual([0, 1, 3]);
  });

  test("rows, paragraphs and fences; an indented line continues its row", () => {
    const md = parseFigureMarkdown([
      "- **Bun workspaces** — one lockfile",
      "  and one test runner",
      "- *pnpm*",
      "  - nested",
      "1. first",
      "",
      "We chose the one we already run.",
      "It is boring.",
      "",
      "```ts",
      "const a = 1; // (1)",
      "```",
    ]);
    expect(md.rows.map(r => [r.text, r.depth, r.ordinal, r.emphasis])).toEqual([
      ["Bun workspaces", 0, null, "strong"], ["pnpm", 0, null, "em"], ["nested", 1, null, null], ["first", 0, 1, null],
    ]);
    expect(md.rows[0]!.note).toBe("one lockfile and one test runner");
    expect(md.rows[0]!.line).toBe(0);
    expect(md.paragraphs).toEqual(["We chose the one we already run. It is boring."]);
    expect(md.fences).toEqual([{ lang: "ts", lines: ["const a = 1; // (1)"], line: 9 }]);
  });

  test("a continuation line keeps its row's emphasis: it is appended to the row as written", () => {
    const [bold] = parseFigureMarkdown(["- **Raised beds**", "  for the squash"]).rows;
    expect(bold).toMatchObject({ text: "Raised beds for the squash", emphasis: "strong" });
    const [whole] = parseFigureMarkdown(["- **Raised beds", "  for the squash**"]).rows;
    expect(whole).toMatchObject({ text: "Raised beds for the squash", emphasis: "strong" });
    const [label] = parseFigureMarkdown(["- **Mar**: seed", "  potatoes — after the frost"]).rows;
    expect(label).toMatchObject({ label: "Mar", value: "seed potatoes", emphasis: "strong", note: "after the frost" });
  });
});
