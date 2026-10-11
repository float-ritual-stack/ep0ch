import { describe, expect, test } from "bun:test";
import { markTitleLine } from "../src/annotation-marks";

describe("markTitleLine", () => {
  test("a comment's title is its own words, never the passage's raw Blockdown", () => {
    const text = "Comment on “Next:** the lantern room, which needs a k…”\n[type::annotation-reply] [annotation-source::user] [parent-annotation::q1]\nLight it before the ferry docks.\nsecond line";
    expect(markTitleLine(text)).toEqual({ line: 2, text: "Light it before the ferry docks." });
  });

  test("a highlight (no body) is its heading without emphasis marks", () => {
    const text = "Highlight on “Next:** the lantern room”\n[type::annotation] [annotation-source::user]";
    expect(markTitleLine(text)).toEqual({ line: 0, text: "Highlight on “Next: the lantern room”" });
  });

  test("a note that only looks like a mark is not one", () => {
    expect(markTitleLine("Comment on “the plan”\nmore words")).toBeNull();
    expect(markTitleLine("Question on “x”\n[type::task]\nwords")).toBeNull();
    expect(markTitleLine("plain note\n[type::annotation]")).toBeNull();
  });
});
