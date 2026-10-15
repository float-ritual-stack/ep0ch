import { describe, expect, test } from "bun:test";
import { blockTags, metadataLines, type TagRecord } from "../src/block-tags";

// Fictional notes; `rec` stands for the service's property records.
const tag = (value: string, line: number, placement = "metadata-line"): TagRecord => ({ key: "tag", value, line, scope: "block", placement, syntax: "hashtag" });
const prop = (key: string, line: number): TagRecord => ({ key, value: "x", line, scope: "block", placement: "metadata-line", syntax: "bracket" });

describe("block-level tags", () => {
  test("a tag on the preamble's lines is the block's tag row, once each, in order", () => {
    const text = "Bed plan [type::plan]\n[season::autumn] #beds #leeks\n#beds\n\nLeeks go in first.";
    const records = [prop("season", 1), tag("beds", 1), tag("leeks", 1), tag("beds", 2)];
    expect(blockTags(text, records)).toEqual({ tags: ["beds", "leeks"], line: 1 });
  });

  test("a tag in the body stays in the body: below the preamble, or inline", () => {
    const text = "Bed plan\n[season::autumn]\n\nLeeks #leeks and\n#late";
    const records = [prop("season", 1), tag("leeks", 3, "inline"), tag("late", 4, "metadata-line")];
    expect(metadataLines(text, records)).toEqual(new Set([1]));
    expect(blockTags(text, records).tags).toEqual([]);
  });

  test("a hand-made row (`- #a - #b`, the first body line) is already the row: no second one for its tags", () => {
    const text = "Bed plan\n[season::autumn] #beds #leeks\n\n- #beds - #fruit\nLeeks first.";
    const records = [prop("season", 1), tag("beds", 1), tag("leeks", 1), tag("beds", 3, "inline"), tag("fruit", 3, "trailing-metadata")];
    expect(blockTags(text, records).tags).toEqual(["leeks"]);
  });

  test("without the service's records there is no row, and the metadata rule is the documented one", () => {
    expect(blockTags("Bed plan\n[a::1] #x\nbody", null)).toEqual({ tags: [], line: -1 });
    expect([...metadataLines("Bed plan\n[a::1]\n[b::2]\nbody", null)]).toEqual([1, 2]);
  });
});
