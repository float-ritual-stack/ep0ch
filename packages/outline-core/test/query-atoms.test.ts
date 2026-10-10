import { describe, expect, test } from "bun:test";
import { isQueryAtomWord, parseQueryAtom, QUERY_ATOM_HELP, QueryAtomError, showQueryAtom, tagMatches } from "../src/query-atoms";

describe("query atoms", () => {
  test("each atom parses", () => {
    expect(parseQueryAtom("#jazz/hands")).toEqual({ kind: "tag", tag: "jazz/hands" });
    expect(parseQueryAtom("links:[[Garden Beds|the beds]]")).toEqual({ kind: "links", target: "[[Garden Beds]]" });
    expect(parseQueryAtom("LINKS:((8f3a2c1d|x))")).toEqual({ kind: "links", target: "((8f3a2c1d))" });
    expect(parseQueryAtom("links:PIE-123")).toEqual({ kind: "links", target: "PIE-123" });
    expect(parseQueryAtom("under:[[projects]]")).toEqual({ kind: "under", target: "[[projects]]" });
    expect(parseQueryAtom("title~Road")).toEqual({ kind: "title", text: "Road" });
    expect(parseQueryAtom('text~"a \\"b\\" c"')).toEqual({ kind: "text", text: 'a "b" c' });
  });

  test("a property clause or a range is no atom", () => {
    for (const word of ["status=doing", "priority", "created>today", "child:status=x"]) {
      expect(isQueryAtomWord(word)).toBe(false);
      expect(parseQueryAtom(word)).toBeNull();
    }
  });

  test("a malformed atom is told what it is and a working example", () => {
    const cases: [string, RegExp][] = [
      ["#", /# needs a tag.*#jazz/],
      ["#123", /not a tag.*#jazz/],
      ["links:", /links: needs a target.*links:\[\[garden\]\]/],
      ["links:[[x", /unclosed \[\[.*links:\[\[garden\]\]/],
      ["links:garden", /not a target.*Work ID/],
      ["under:", /under: needs a target.*under:\[\[projects\]\]/],
      ["under:((", /unclosed \(\(/],
      ["title~", /title~ needs text.*title~roadmap/],
      ['title~"', /unterminated quote/],
      ['text~"a"b', /after its closing quote/],
      ['title~""', /needs text to look for/],
    ];
    for (const [word, message] of cases) {
      expect(() => parseQueryAtom(word), word).toThrow(QueryAtomError);
      try { parseQueryAtom(word); } catch (error) { expect((error as Error).message, word).toMatch(message); }
    }
  });

  test("an atom shows as written and a tag matches its nested tags", () => {
    expect(showQueryAtom({ kind: "title", text: "weekly review" })).toBe('title~"weekly review"');
    expect(showQueryAtom({ kind: "tag", tag: "jazz" })).toBe("#jazz");
    expect(tagMatches(["Jazz/Hands"], "jazz")).toBe(true);
    expect(tagMatches(["jazzy"], "jazz")).toBe(false);
  });

  test("linkedfrom: and parent: take the targets links: does, and this (ADR 0004)", () => {
    expect(parseQueryAtom("linkedfrom:[[garden]]")).toEqual({ kind: "linkedfrom", target: "[[garden]]" });
    expect(parseQueryAtom("parent:((8f3a2c1d))")).toEqual({ kind: "parent", target: "((8f3a2c1d))" });
    expect(parseQueryAtom("links:this")).toEqual({ kind: "links", target: "this" });
    expect(parseQueryAtom("PARENT:This")).toEqual({ kind: "parent", target: "this" });
    expect(showQueryAtom({ kind: "linkedfrom", target: "this" })).toBe("linkedfrom:this");
    expect(() => parseQueryAtom("parent:")).toThrow(/parent: needs a target.*parent:this/);
    expect(() => parseQueryAtom("linkedfrom:garden")).toThrow(/not a target.*Work ID or this/);
    expect(QUERY_ATOM_HELP.map(h => h.atom)).toEqual(expect.arrayContaining(["linkedfrom:<target>", "parent:<target>", "this"]));
  });
});
