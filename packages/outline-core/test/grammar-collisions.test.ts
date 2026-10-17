// Grammar collisions (PIE-533 S0d): a token that looks like two things is only the one its place allows.
import { describe, expect, test } from "bun:test";
import { componentBlocks } from "../src/component-block";
import { headerLine, readFrontMatter, readNoteFile } from "../src/header-line";
import { parsePropertyRecords, parseProperties } from "../src/property-parse";
import { isHexColour } from "../src/property-grammar";
import { startsTable } from "../src/table-shape";

const keys = (text: string) => parseProperties(text).map(p => `${p.key}=${p.value}`);

describe("a hex colour is not a tag", () => {
  test("3, 4, 6 and 8 hex digits are colours; other lengths and non-hex words stay tags", () => {
    for (const c of ["fff", "00e5ff", "1a2b3c", "ABCD", "1a2b3c80"]) expect(isHexColour(c)).toBe(true);
    for (const c of ["622x", "12", "12345", "1234567", "garden", "gg0000"]) expect(isHexColour(c)).toBe(false);
  });

  test("in prose and in the header run", () => {
    expect(keys("Palette: #00e5ff on #fff, then #1a2b3c #garden")).toEqual(["tag=garden"]);
    expect(headerLine("Palette #fff #garden").tags).toHaveLength(1);
    expect(headerLine("Palette #00e5ff").tags).toEqual([]);
    expect(headerLine("Palette #00e5ff").prose).toBe("Palette #00e5ff");
    expect(keys("Issue #622 and #6a2x")).toEqual(["tag=6a2x"]);
  });
});

describe("--- has four jobs", () => {
  test("a first-line divider with no keys is a divider, not empty front matter", () => {
    expect(readFrontMatter("---\n\nA paragraph.\n\n---\nTail\n")).toBeNull();
    expect(readNoteFile("---\n\nA paragraph.\n---\n")).toBeNull();
    expect(readFrontMatter("---\nA paragraph.\n---\nTail")).toBeNull();
    expect(readFrontMatter("---\n---\nTail")).toEqual({ fields: [], rest: "Tail" });
    // A real block still reads, and everything before the first blank line is the note's.
    expect(readFrontMatter("---\ntype: job\n---\nBody")?.fields).toEqual([["type", "job"]]);
    // The divider is the note's whole first paragraph: a key under it is a line's, not the note's.
    expect(keys("---\n\nstatus:: open")).toEqual([]);
    expect(parsePropertyRecords("---\n\nstatus:: open").map(r => r.scope)).toEqual(["line"]);
    expect(headerLine("---\n\nbody").chips).toEqual([]);
  });

  test("front matter: everything before the first blank line belongs to the note", () => {
    expect(keys("Title\ntype:: job\n\nbody")).toEqual(["type=job"]);
  });

  test("a figure's settings fence is the component's, not front matter", () => {
    const lines = ["::graph-stat", "---", "title: Beans", "---", "::", "after"];
    expect(componentBlocks(lines).map(c => [c.start, c.end])).toEqual([[0, 4]]);
  });

  test("a Markdown rule between paragraphs is not a property or a component", () => {
    expect(keys("Above\n\n---\n\nBelow")).toEqual([]);
    expect(componentBlocks(["Above", "", "---", "", "Below"])).toEqual([]);
  });

  test("a table's | --- | row is not front matter, a rule or a tag", () => {
    expect(keys("| a | b |\n| --- | --- |\n| 1 | 2 |")).toEqual([]);
    expect(startsTable(["| a | b |", "| --- | --- |", "| 1 | 2 |"], 0)).toBe(true);
  });
});

describe(":: in prose", () => {
  test("std::vec, Foo::bar and a::b mid-prose are neither a component nor a property", () => {
    for (const t of ["Use std::vec here", "Call Foo::bar() then", "see Foo::bar and x:y in std::vec"]) {
      expect(keys(t)).toEqual([]);
      expect(componentBlocks(t.split("\n"))).toEqual([]);
    }
    expect(keys("Notes on std::vec\nsecond line Foo::bar")).toEqual([]);
    // At a line start, `key::value` is a property whether or not a blank follows (`ctx::2026-09-24` is written that way).
    expect(keys("ctx::2026-09-24")).toEqual(["ctx=2026-09-24"]);
    expect(keys("a:: b")).toEqual(["a=b"]);
  });

  test("a component opens at a line start; a chip is inside [ ] or a key:: line", () => {
    expect(componentBlocks(["::links", "::"]).length).toBe(1);
    expect(componentBlocks(["text ::links", "::"])).toEqual([]);
    expect(keys("[type::job]")).toEqual(["type=job"]);
    expect(keys("Title\nstatus:: open")).toEqual(["status=open"]);
  });
});
