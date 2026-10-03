import { describe, expect, test } from "bun:test";
import {
  fieldChips, frontMatter, headerFields, headerLine, joinHeaderLine, bodyOffset, noteFile, readFrontMatter, readNoteFile, textFromHeader, withoutHeaderDashes,
} from "../src/header-line";

// Fictional notes.
const chips = (text: string, literal: { start: number; end: number }[] = []) => headerLine(text, literal).chips.map(c => [c.key, c.value]);

describe("the header line", () => {
  test("prose before the chips is the line's prose; the chips that end the line are the header, in order", () => {
    const h = headerLine("Seed order for the plot [type::errand] [area::garden]\nBroad beans, two packets.");
    expect(h.prose).toBe("Seed order for the plot");
    expect(chips("Seed order for the plot [type::errand] [area::garden]")).toEqual([["type", "errand"], ["area", "garden"]]);
    expect(h.body).toBe("Seed order for the plot\nBroad beans, two packets.");
    expect(h.line).toBe(0);
  });

  test("` - ` separates chips as blanks do, and before them it leaves the prose", () => {
    const h = headerLine("Seed order - [type::errand] - [area::garden]");
    expect(h.prose).toBe("Seed order");
    // The separators, for a title to leave out with the chips.
    expect(h.dashes.map(d => "Seed order - [type::errand] - [area::garden]".slice(d.start, d.end))).toEqual([" -", " -"]);
    expect(withoutHeaderDashes("Shed [a::1] #t - [b::2]")).toBe("Shed [a::1] #t [b::2]");
    expect(h.chips.map(c => c.key)).toEqual(["type", "area"]);
  });

  test("a chip something follows is an inline aside, not the header; so are those before it", () => {
    expect(chips("Ask [who::Sam] about the shed")).toEqual([]);
    expect(chips("[who::Sam] [when::Friday] asked about the shed")).toEqual([]);
    // Prose between chips: only the run at the end is the header.
    const h = headerLine("[when::Friday] Shed key [who::Sam]");
    expect(h.prose).toBe("[when::Friday] Shed key");
    expect(h.chips.map(c => c.key)).toEqual(["who"]);
  });

  test("chips only: empty prose, and the body starts with that empty line", () => {
    const h = headerLine("[type::list] - [area::kitchen]\nTea, milk, oats.");
    expect(h.prose).toBe("");
    expect(h.body).toBe("\nTea, milk, oats.");
  });

  test("a hashtag among the chips stays with the prose, and the run goes on past it", () => {
    const h = headerLine("Shed jobs [type::list] #bikes [area::shed]");
    expect(h.prose).toBe("Shed jobs #bikes");
    expect(h.dashes).toEqual([]);
    expect(h.chips.map(c => c.key)).toEqual(["type", "area"]);
  });

  test("a token in a literal range or escaped is text; values are kept verbatim; keys as written", () => {
    const text = "Use `[x::1]` here [ctx::2026-03-09 @ 09:27:29 AM] [Area::Garden]";
    expect(chips(text, [{ start: 4, end: 12 }])).toEqual([["ctx", "2026-03-09 @ 09:27:29 AM"], ["Area", "Garden"]]);
    expect(chips("Not this \\[x::1]")).toEqual([]);
  });

  test("the first line with anything on it is the header line; offsets are the whole text's", () => {
    const h = headerLine("\n\nShed [type::place]");
    expect(h.line).toBe(2);
    expect("\n\nShed [type::place]".slice(h.chips[0]!.start, h.chips[0]!.end)).toBe("[type::place]");
    expect(headerLine("  \n").line).toBe(-1);
  });
});

describe("the separator rule, and where offsets land", () => {
  test("a hyphen separates only with blanks on both sides; a bullet before the chips stays prose; #42 isn't a tag", () => {
    expect(chips("[a::1]-[b::2]")).toEqual([["b", "2"]]);
    expect(headerLine("Pros-[a::1]").prose).toBe("Pros-");
    expect(headerLine("- [a::1] [b::2]").prose).toBe("-");
    expect(chips("Shed [a::1] #42 [b::2]")).toEqual([["b", "2"]]);
    expect(chips("Shed [a::1] #garden/beds - [b::2]")).toEqual([["a", "1"], ["b", "2"]]);
  });

  test("bodyOffset: the prose keeps its place, chips and separators aren't in the body, later lines shift", () => {
    const text = "\nSeed order [type::errand] - [area::garden]\nFor ((x)) here.";
    const h = headerLine(text);
    expect(h.body).toBe("Seed order\nFor ((x)) here.");
    expect(bodyOffset(h, text.indexOf("order"))).toBe(h.body.indexOf("order"));
    expect(bodyOffset(h, text.indexOf("((x))"))).toBe(h.body.indexOf("((x))"));
    expect(bodyOffset(h, text.indexOf("[area"))).toBe(-1);
    expect(bodyOffset(h, 0)).toBe(-1);
  });

  test("YAML keys it would read as something else are quoted; line separators escaped", () => {
    expect(frontMatter([["on", "x"], ["Yes", "1"], ["type", "a\u2028b"]])).toBe('---\n"on": "x"\n"Yes": "1"\ntype: "a\\u2028b"\n---');
    expect(readFrontMatter('---\n"on": "x"\ntype: "a\\u2028b"\n---\n')!.fields).toEqual([["on", "x"], ["type", "a\u2028b"]]);
  });
});

describe("front matter and back", () => {
  test("a repeated key becomes a list at its first place; values are double-quoted strings, never dates", () => {
    const fields = headerFields([{ key: "tag", value: "seeds" }, { key: "ctx", value: "2026-03-09 @ 09:27:29 AM" }, { key: "tag", value: "spring" }]);
    expect(fields).toEqual([["tag", ["seeds", "spring"]], ["ctx", "2026-03-09 @ 09:27:29 AM"]]);
    const yaml = frontMatter(fields);
    expect(yaml).toBe('---\ntag:\n  - "seeds"\n  - "spring"\nctx: "2026-03-09 @ 09:27:29 AM"\n---');
    expect(readFrontMatter(`${yaml}\nbody`)).toEqual({ fields, rest: "body" });
    expect(fieldChips(fields)).toEqual([{ key: "tag", value: "seeds" }, { key: "tag", value: "spring" }, { key: "ctx", value: "2026-03-09 @ 09:27:29 AM" }]);
  });

  test("rebuilding joins the prose and the chips with ` - `, and reads back to the same prose and chips", () => {
    expect(joinHeaderLine("Seed order", [{ key: "type", value: "errand" }, { key: "area", value: "garden" }])).toBe("Seed order - [type::errand] - [area::garden]");
    for (const text of [
      "Seed order for the plot [type::errand] [area::garden]\nBroad beans.\n\n- two packets",
      "[type::list] [area::kitchen]\nTea, milk.",
      "Shed key [who::Sam] said so [when::Friday]",
      "Just a title",
      "Shed jobs [type::list] #bikes [area::shed]",
      "Odd `[x::1]` code [y::2]",
    ]) {
      const h = headerLine(text, text.includes("`") ? [{ start: 4, end: 12 }] : []);
      const back = textFromHeader(h.chips, h.body);
      const again = headerLine(back, back.includes("`") ? [{ start: 4, end: 12 }] : []);
      expect(again.prose).toBe(h.prose);
      expect(again.chips.map(c => [c.key, c.value])).toEqual(h.chips.map(c => [c.key, c.value]));
      expect(again.body).toBe(h.body);
    }
    // Spacing only: one blank is ` - `.
    expect(textFromHeader([{ key: "a", value: "1" }], "Title\nrest")).toBe("Title - [a::1]\nrest");
  });

  test("a note's file: identity first, then the header; read back to the text, with the ` - ` separators", () => {
    const text = "Seed order for the plot [type::errand] [tag::seeds] [tag::spring]\nBroad beans, two packets.\nwhen:: before Friday";
    const h = headerLine(text);
    const file = noteFile({ id: "1111", parent: "2222", created: "2026-03-09T09:00:00.000Z", updated: "2026-03-09T09:30:00.000Z", author: "user" }, h.chips, h.body);
    expect(file).toBe([
      "---", 'id: "1111"', 'parent: "2222"', 'created: "2026-03-09T09:00:00.000Z"', 'updated: "2026-03-09T09:30:00.000Z"', 'author: "user"',
      'type: "errand"', "tag:", '  - "seeds"', '  - "spring"', "---",
      "Seed order for the plot", "Broad beans, two packets.", "when:: before Friday", "",
    ].join("\n"));
    const back = readNoteFile(file)!;
    expect(back.identity).toEqual({ id: "1111", parent: "2222", created: "2026-03-09T09:00:00.000Z", updated: "2026-03-09T09:30:00.000Z", author: "user" });
    expect(back.text).toBe("Seed order for the plot - [type::errand] - [tag::seeds] - [tag::spring]\nBroad beans, two packets.\nwhen:: before Friday");
  });

  test("a chip with an identity key stays in the body's first line, so it is never read back as identity", () => {
    const h = headerLine("Visitor log [author::Robin] [type::log]");
    const file = noteFile({ id: "1111", author: "agent", actor: "planner" }, h.chips, h.body);
    expect(file).toContain('author: "agent"\nactor: "planner"\ntype: "log"\n---\nVisitor log - [author::Robin]');
    const back = readNoteFile(file)!;
    expect(back.identity.author).toBe("agent");
    expect(headerLine(back.text).chips.map(c => [c.key, c.value])).toEqual([["author", "Robin"], ["type", "log"]]);
  });
});
