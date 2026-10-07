import { describe, expect, test } from "bun:test";
import { builtInSpec, compileRulePattern, expandTemplate, noteConstructs, parseKindSpec, ruleHits, rulesFromBlocks } from "../src/rules";

const NOTE = [
  "Allotment plan",
  "# Beds",
  "Raised beds by the shed.",
  "## Squash ^squash",
  "- sow in May",
  "  - water daily",
  "- net against pigeons",
  "",
  "> [!warning] Frost",
  "> Not before the last frost.",
  "---",
  "![the plot](plot.png)",
  "```",
  "# not a heading",
  "WATER THE LEEKS!!!",
  "```",
  "Turn the compost!!! `code!!!`",
].join("\n");

describe("noteConstructs", () => {
  test("headings, a list, a callout, a rule and an image, by whole-text line; nothing in a fence", () => {
    const got = noteConstructs(NOTE).map(c => [c.kind, c.line, c.end, c.level, c.text, c.type ?? ""]);
    expect(got).toEqual([
      ["heading", 1, 2, 1, "Beds", ""],
      ["heading", 3, 4, 2, "Squash", ""],
      ["list", 4, 7, 0, "sow in May", ""],
      ["callout", 8, 10, 1, "Frost", "warning"],
      ["rule", 10, 11, 0, "", ""],
      ["image", 11, 12, 0, "plot.png", ""],
    ]);
  });
  test("a heading in a literal region is text", () => {
    expect(noteConstructs("T\n<!-- literal -->\n# kept as text\n<!-- /literal -->\n# Real").map(c => c.text)).toEqual(["Real"]);
  });
  test("a media line is an image", () => {
    expect(noteConstructs("T\n[img::beds.jpg] [size::40%]").map(c => [c.kind, c.text])).toEqual([["image", "beds.jpg"]]);
  });
});

describe("kinds and patterns", () => {
  test("parseKindSpec", () => {
    expect(parseKindSpec("h2")).toEqual({ kind: "heading", level: 2 });
    expect(parseKindSpec("heading:1")).toEqual({ kind: "heading", level: 1 });
    expect(parseKindSpec("callout:warning")).toEqual({ kind: "callout", type: "warning" });
    expect(parseKindSpec("list")).toEqual({ kind: "list" });
    expect("problem" in parseKindSpec("table")).toBe(true);
    expect("problem" in parseKindSpec("heading:9")).toBe(true);
  });
  test("compileRulePattern: (?i), an empty hit refused, a bad one said", () => {
    expect((compileRulePattern("(?i)shout") as RegExp).flags).toContain("i");
    expect("problem" in compileRulePattern("x*")).toBe(true);
    expect("problem" in compileRulePattern("(")).toBe(true);
  });
});

describe("ruleHits", () => {
  test("no text or kind: the whole block", () => {
    expect(ruleHits(NOTE, {})).toEqual([{ at: "block", line: 0, end: 17, text: "Allotment plan" }]);
  });
  test("a kind: each construct of it", () => {
    expect(ruleHits(NOTE, { kind: { kind: "heading", level: 2 } }).map(h => [h.line, h.text])).toEqual([[3, "Squash"]]);
  });
  test("a pattern: line by line, never in a fence or a code span, with its captures", () => {
    const hits = ruleHits(NOTE, { text: /(\S.*?)!!!/u });
    expect(hits.map(h => [h.line, h.captures])).toEqual([[16, ["Turn the compost!!!", "Turn the compost"]]]);
  });
  test("a pattern never matches a property token (a rule note's own rule-text)", () => {
    expect(ruleHits("Shout [rule-name::shout] [rule-text::(.+)!!!]", { text: /(.+)!!!/u })).toEqual([]);
  });
  test("a pattern and a kind: only inside that kind", () => {
    expect(ruleHits(NOTE, { text: /pigeons/u, kind: { kind: "list" } }).map(h => h.line)).toEqual([6]);
    expect(ruleHits(NOTE, { text: /Raised/u, kind: { kind: "list" } })).toEqual([]);
  });
});

describe("built-in decorations and templates", () => {
  test("builtInSpec keeps what it can and says the rest", () => {
    const r = builtInSpec({ use: "band", pattern: "waffle", align: "middle", tone: "accent", fields: "who, when, 9bad" });
    expect("spec" in r && r.spec).toEqual({ use: "band", pattern: "waffle", tone: "accent", fields: ["who", "when"] });
    expect("spec" in r && r.problems.length).toBe(2);
    expect("problem" in builtInSpec({ use: "sparkle" })).toBe(true);
  });
  test("expandTemplate", () => {
    const props: Record<string, string[]> = { attendees: ["Ann", "Bo"] };
    expect(expandTemplate("{title} · {attendees} · {$1} · {level} · {nope}", { title: "Sync", text: "x", level: 2, captures: ["a!!", "a"], property: k => props[k] ?? [] }))
      .toBe("Sync · Ann, Bo · a · 2 · ");
  });
});

describe("rulesFromBlocks", () => {
  const block = (id: string, props: Record<string, string>) => ({ id, properties: Object.entries(props).map(([key, value]) => ({ key, value })) });
  test("a rule note: its match and its built-in decoration", () => {
    const { rules, problems } = rulesFromBlocks([
      block("11111111-0000-4000-8000-000000000001", { "rule-name": "h1-band", "rule-kind": "heading:1", "rule-decorate": "band", "rule-pattern": "stack", "rule-align": "center" }),
      block("11111111-0000-4000-8000-000000000002", { "rule-name": "Meetings", "rule-match": "type=meeting", "rule-decorate": "card", "rule-fields": "attendees, when", "rule-place": "below" }),
    ]);
    expect(problems).toEqual([]);
    expect(rules).toEqual([
      { name: "h1-band", block: "11111111-0000-4000-8000-000000000001", match: { kind: "heading:1" }, decorate: { use: "band", pattern: "stack", align: "center" } },
      { name: "meetings", block: "11111111-0000-4000-8000-000000000002", match: { query: "type=meeting" }, place: "below", decorate: { use: "card", fields: ["attendees", "when"] } },
    ]);
  });
  test("what can't be used is said, and the first note keeps a name", () => {
    const { rules, problems } = rulesFromBlocks([
      block("22222222-0000-4000-8000-000000000001", { "rule-name": "x", "rule-decorate": "badge" }),
      block("22222222-0000-4000-8000-000000000002", { "rule-name": "y", "rule-text": "(", "rule-decorate": "badge" }),
      block("22222222-0000-4000-8000-000000000003", { "rule-name": "z", "rule-kind": "rule", "rule-decorate": "divider" }),
      block("22222222-0000-4000-8000-000000000004", { "rule-name": "z", "rule-kind": "rule", "rule-decorate": "divider" }),
      block("22222222-0000-4000-8000-000000000005", { "rule-name": "v", "rule-view": "not an id", "rule-kind": "list", "rule-decorate": "box" }),
    ]);
    // v's scope can't be read: it's left out rather than applied everywhere.
    expect(rules.map(r => r.name)).toEqual(["z"]);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain("matches nothing");
  });
});

test("a pattern that repeats a repeating group is refused: it could take forever on one line", () => {
  for (const bad of ["(a+)+$", "(?:\\w*x)*", "(a{2,})+", "(x|y*)*z", "(a|aa)+$", "(?:x|y)*", "^((a+))+$", "(?:a+)+", "(a*)*", "(a|a)*", "((a|b))+c", "(a{1,9}){1,9}", "(a+)\\1", "a*a*a*b", ".*.*.*x", "\\s*\\w+\\d*z", ".*\\w*\\s*x", "^(a?a?)+$", "^a*aa*aa*aa*b", "^(?:a)*(?:a)*(?:a)*(?:a)*b"]) expect("problem" in compileRulePattern(bad)).toBe(true);
  for (const ok of ["(\\S.*?)!!!$", "^(?:[-*]\\s+)?(\\S.*?)\\s*!!!\\s*$", "(ab)+", "[a+]+", "(a|b)c", "(?:foo|bar):", "a*xa*xa*y", "\\s*!!!\\s*$", "(\\w+)?x+y*", "a+|b+|c+|d+x*", "(?<n>a|b)c", "(?=a+)b"]) expect(compileRulePattern(ok)).toBeInstanceOf(RegExp);
});

test("a known catastrophic shape is refused fast, and a long line cannot make a safe pattern slow", () => {
  const started = performance.now();
  for (const bad of ["^((a+))+$", "(x+x+)+y", "^(a|aa)+$", "^(([a-z])+.)+[A-Z]([a-z])+$"]) expect("problem" in compileRulePattern(bad)).toBe(true);
  const safe = compileRulePattern("^(?:[-*]\\s+)?(\\S.*?)\\s*!!!\\s*$") as RegExp;
  expect(ruleHits("a".repeat(5_000), { text: safe })).toEqual([]);
  expect(performance.now() - started).toBeLessThan(500);
});
