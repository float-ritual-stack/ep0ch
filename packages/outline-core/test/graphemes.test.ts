// Where a cursor may stop (PIE-1290): every place a person types steps by what they see as one character. The run
// that found it: backspace on "ab" plus a family emoji left a dangling joiner in the door and a lone surrogate in Herdr.
import { describe, expect, test } from "bun:test";
import { eraseBack, nextGraphemeEnd, previousGraphemeStart, wordEraseStart } from "../src/graphemes";

describe("grapheme steps", () => {
  test.each(["👨‍👩‍👧", "🇨🇦", "é", "👍🏽", "x"])("backspace after %s takes it whole", ch => {
    expect(eraseBack("ab" + ch, ("ab" + ch).length)).toEqual({ text: "ab", column: 2 });
    expect(nextGraphemeEnd(ch + "cd", 0)).toBe(ch.length);
    expect(previousGraphemeStart("ab" + ch + "cd", 2 + ch.length)).toBe(2);
  });

  test("ctrl+w erases the word before the cursor and the spaces after it, as a shell does", () => {
    expect(wordEraseStart("seed swap  ", 11)).toBe(5);
    expect(wordEraseStart("seed swap", 9)).toBe(5);
    expect(wordEraseStart("seed", 2)).toBe(0);
  });
});
