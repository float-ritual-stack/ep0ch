// outline-core's property-grammar.ts is the one definition of the property token (PIE-490). The parser uses it and
// the door imports it, so it must stay free of imports and agree with the parser.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePropertyRecords } from "../src/properties";
import {
  isLinkValue,
  isWritablePropertyValue,
  propertyValueHolds,
  replacePropertyTokens,
  splitPropertyValue,
  isPropertyKey,
  isPropertyTokenLine,
  propertyTokensInLine,
  withoutPropertyTokens,
} from "@ep0ch/outline-core/property-grammar";

test("the key rule: a letter first, then letters, digits, _ . -", () => {
  for (const key of ["plot.row", "bed_2", "work-stage", "A"]) expect(isPropertyKey(key)).toBe(true);
  for (const key of ["2nd-pass", "-x", "_x", "", "a b", "é"]) expect(isPropertyKey(key)).toBe(false);
});

test("a line's tokens are exactly the ones the parser reads, outside code and literal regions", () => {
  const lines = [
    "Plan [2nd-pass::yes] beans",
    "Plan [plot.row::3] beans",
    "Plan [empty::] beans",
    "Water the [bed_2::east] rows [kind::herb]",
    "Escaped \\[kind::herb] stays, \\\\[kind::tree] doesn't",
    "[type::task]   [work-stage::doing]",
    "Nested [a::[b::c]] tokens",
  ];
  for (const line of lines) {
    const theirs = parsePropertyRecords(line).filter(t => t.syntax === "bracket").map(t => ({ key: t.key, value: t.value, start: t.start }));
    expect({ line, tokens: propertyTokensInLine(line).map(({ key, value, start }) => ({ key, value, start })) }).toEqual({ line, tokens: theirs });
  }
  expect(withoutPropertyTokens("Plan [plot.row::3] beans [2nd-pass::yes]")).toBe("Plan  beans [2nd-pass::yes]");
  expect(isPropertyTokenLine("  [type::task] [stage::doing] ")).toBe(true);
  expect(isPropertyTokenLine("[type::task] and prose")).toBe(false);
  expect(isPropertyTokenLine("[2nd-pass::yes]")).toBe(false);
});

test("the module imports only outline-core's own link grammar and code rule: outline-core stays pure", () => {
  const source = readFileSync(join(import.meta.dir, "../../outline-core/src/property-grammar.ts"), "utf8");
  for (const line of source.match(/^\s*import\s.*$/gm) ?? []) expect(line).toMatch(/from "\.\/(?:link-syntax|code-ranges)"/);
  expect(source).not.toMatch(/\brequire\(/);
});

const ID = "0f3c8a21-5b7d-4e69-8a10-2c4d6e8f0a1b";

describe("a value holding links parses whole", () => {
  test("the real shape: a wiki link and a labelled reference in one value", () => {
    const line = `Plan day [related::[[PC-967]], ((${ID}|daytime plan step 6))] [type::task]`;
    expect(propertyTokensInLine(line).map(t => [t.key, t.value])).toEqual([
      ["related", `[[PC-967]], ((${ID}|daytime plan step 6))`],
      ["type", "task"],
    ]);
    const records = parsePropertyRecords(line).filter(r => r.syntax === "bracket");
    expect(records.map(r => [r.key, r.value])).toEqual([["related", `[[PC-967]], ((${ID}|daytime plan step 6))`], ["type", "task"]]);
  });

  test("several links, labels with commas, brackets and parentheses", () => {
    for (const value of [
      "[[Garden]], [[Shed|the shed]], [[Beds]]",
      `((${ID})), ((${ID}|a, b, c))`,
      `((${ID}|label with ] a bracket and [another))`,
      `((${ID}|Rough edges (x)))`,
      `!((${ID}))`,
      "[[Garden|beds [north]]]".replace("[north]", "north"),
      "see [[Garden]] and plain words, more",
      "a [nested] bracket",
    ]) {
      const [token, ...rest] = propertyTokensInLine(`x [k::${value}] y [z::1]`);
      expect({ value, got: token?.value }).toEqual({ value, got: value });
      expect(rest.map(t => t.key)).toEqual(["z"]);
    }
  });

  test("a list splits at commas outside links, never inside one", () => {
    expect(splitPropertyValue(`[[PC-967]], ((${ID}|plan, step 6)), notes`)).toEqual(["[[PC-967]]", `((${ID}|plan, step 6))`, "notes"]);
    expect(splitPropertyValue("a, b,, c")).toEqual(["a", "b", "c"]);
    expect(splitPropertyValue("[[A, B]], [x, y]")).toEqual(["[[A, B]]", "[x, y]"]);
    expect(splitPropertyValue("single")).toEqual(["single"]);
  });

  test("unbalanced brackets cost that value its tail, never the rest of the note or line", () => {
    expect(propertyTokensInLine("[note::a [ b] and [k::v]").map(t => [t.key, t.value])).toEqual([["note", "a [ b"], ["k", "v"]]);
    expect(propertyTokensInLine("[note::oops ((" + ID + "|never closed] [k::v]").map(t => [t.key, t.value])).toEqual([["note", "oops ((" + ID + "|never closed"], ["k", "v"]]);
    expect(propertyTokensInLine("[note::no close here")).toEqual([]);
    const text = "[note::open [ here\nnext line [k::v]\nlast";
    expect(propertyTokensInLine(text.split("\n")[0]!)).toEqual([]);
    expect(parsePropertyRecords("[note::open [ here\n[k::v]\nlast").map(r => [r.key, r.value])).toEqual([["k", "v"]]);
  });

  test("escaped tokens and empty values stay text", () => {
    expect(propertyTokensInLine("\\[k::[[A]]] [j::[[B]]]").map(t => t.key)).toEqual(["j"]);
    expect(propertyTokensInLine("[empty::] [also::]]")).toEqual([]);
    expect(replacePropertyTokens("a [k::[[A]]] \\[j::1] b", t => `<${t.value}>`)).toBe("a <[[A]]> \\[j::1] b");
  });

  test("code and literal regions are the parser's, unchanged", () => {
    expect(parsePropertyRecords("`[k::[[A]]]` and [j::[[B]]]").filter(r => r.syntax === "bracket").map(r => r.key)).toEqual(["j"]);
    expect(parsePropertyRecords("```\n[k::[[A]]]\n```\n[j::[[B]]]").filter(r => r.syntax === "bracket").map(r => r.key)).toEqual(["j"]);
  });

  test("writable values and link values", () => {
    for (const ok of ["[[PC-967]]", `((${ID}|a ] b))`, "plain", "a, [[B]]", "a [ b"]) expect(isWritablePropertyValue(ok)).toBe(true);
    for (const bad of ["", "a]b", "two\nlines", "[[A]"]) expect(isWritablePropertyValue(bad)).toBe(false);
    expect(isLinkValue("[[PC-967]]")).toBe(true);
    expect(isLinkValue(`((${ID}|plan))`)).toBe(true);
    expect(isLinkValue("[[A]], [[B]]")).toBe(false);
    expect(isLinkValue("plain")).toBe(false);
  });

  test("a link filter finds a list that holds the link; other filters compare whole", () => {
    const value = `[[PC-967]], ((${ID}|plan, step 6))`;
    expect(propertyValueHolds(value, "[[pc-967]]")).toBe(true);
    expect(propertyValueHolds(value, `((${ID}|plan, step 6))`)).toBe(true);
    expect(propertyValueHolds(value, "[[PC-9]]")).toBe(false);
    expect(propertyValueHolds(value, "PC-967")).toBe(false);
    expect(propertyValueHolds("a, b", "a")).toBe(false);
  });
});
