// Code is opaque (PIE-764): a link, a property or a completion trigger in a code span or a fence is text, by the one
// rule (code-ranges.ts). Fictional notes, one of them kitty's request as written.
import { describe, expect, test } from "bun:test";
import { codeHides, codeSpanRanges, cursorInCode, scanPropertyLiteralRanges } from "../src/code-ranges";
import { blockReferenceOccurrences, linkOccurrences, pageAddressReferences } from "../src/link-syntax";
import { headerLine } from "../src/header-line";
import { isPropertyTokenLine, propertyTokensInLine, replacePropertyTokens, withoutPropertyTokens } from "../src/property-grammar";
import { referenceSuspects, referenceWarnings } from "../src/reference-warnings";
import { FENCED_LINKS_NOTE, KITTY_REQUEST_NOTE, QUOTED_TARGET_ID, STRAY_BACKTICK_NOTE } from "./fixtures/code-notes";

const spans = (text: string) => codeSpanRanges(text).map(r => text.slice(r.start, r.end));

describe("the code span rule", () => {
  test("a run closes at the next run of exactly as many backticks on its line", () => {
    expect(spans("a `x` and ``y ` z`` and ```q```")).toEqual(["`x`", "``y ` z``", "```q```"]);
  });

  test("an unclosed run is text: it hides nothing, and a later run may still open a span", () => {
    expect(spans("a `` stray, then `real`")).toEqual(["`real`"]);
    expect(spans("one ` lone")).toEqual([]);
  });

  test("a span never crosses a line", () => {
    expect(spans("`open\nclose`")).toEqual([]);
  });

  test("a range is hidden unless it holds the code strictly inside it", () => {
    expect(codeHides({ start: 2, end: 8 }, [{ start: 0, end: 10 }])).toBe(true);
    expect(codeHides({ start: 0, end: 10 }, [{ start: 0, end: 10 }])).toBe(true);
    expect(codeHides({ start: 0, end: 10 }, [{ start: 3, end: 6 }])).toBe(false);
    expect(codeHides({ start: 0, end: 10 }, [{ start: 6, end: 12 }])).toBe(true);
  });
});

describe("links", () => {
  test("kitty's request: neither quoted form is a reference, the real one is", () => {
    expect(blockReferenceOccurrences(KITTY_REQUEST_NOTE).map(r => r.blockId)).toEqual([QUOTED_TARGET_ID]);
    expect(linkOccurrences(KITTY_REQUEST_NOTE).map(l => KITTY_REQUEST_NOTE.slice(l.start, l.end))).toEqual([`((${QUOTED_TARGET_ID}|meeting notes))`]);
  });

  test("a fence holding [[x]], a reference and an embed: all text; the page link after it is one", () => {
    expect(linkOccurrences(FENCED_LINKS_NOTE).map(l => FENCED_LINKS_NOTE.slice(l.start, l.end))).toEqual(["[[Garden]]"]);
  });

  test("a reference whose label holds a code span is a reference; one whose )) a span runs past isn't", () => {
    const label = `((${QUOTED_TARGET_ID}|the \`--dry\` flag))`;
    expect(blockReferenceOccurrences(label)).toHaveLength(1);
    expect(blockReferenceOccurrences(`((${QUOTED_TARGET_ID}|half \`way)) out\``)).toEqual([]);
  });

  test("a line scan ('inline') sees only its code spans; [] is the raw grammar", () => {
    const line = "    [[Indented]] `[[Quoted]]`";
    expect(pageAddressReferences(line).map(p => p.displayAddress)).toEqual([]); // a whole note: indented code
    expect(pageAddressReferences(line, "inline").map(p => p.displayAddress)).toEqual(["Indented"]);
    expect(pageAddressReferences(line, []).map(p => p.displayAddress)).toEqual(["Indented", "Quoted"]);
  });
});

describe("properties", () => {
  test("a quoted [key::value] is text: not a token, not a chip, not taken out of the line", () => {
    const line = "Write `[key::value]` like this [type::guide]";
    expect(propertyTokensInLine(line).map(t => t.key)).toEqual(["type"]);
    expect(withoutPropertyTokens(line)).toBe("Write `[key::value]` like this ");
    expect(isPropertyTokenLine("`[key::value]`")).toBe(false);
    expect(replacePropertyTokens(line, t => `<${t.key}>`)).toBe("Write `[key::value]` like this <type>");
    expect(headerLine(line).chips.map(c => c.key)).toEqual(["type"]);
  });

  test("kitty's request: its header chips are read, the quoted one isn't", () => {
    expect(headerLine(KITTY_REQUEST_NOTE, scanPropertyLiteralRanges(KITTY_REQUEST_NOTE)).chips.map(c => [c.key, c.value]))
      .toEqual([["type", "request"], ["thread", "requests"]]);
  });

  test("an unclosed backtick before a property line hides no property, on its line or the next (#362's bug)", () => {
    expect(scanPropertyLiteralRanges(STRAY_BACKTICK_NOTE).map(r => STRAY_BACKTICK_NOTE.slice(r.start, r.end))).toEqual(["`code`"]);
    expect(headerLine(STRAY_BACKTICK_NOTE, scanPropertyLiteralRanges(STRAY_BACKTICK_NOTE)).chips.map(c => c.key)).toEqual(["type"]);
    expect(propertyTokensInLine(STRAY_BACKTICK_NOTE.split("\n")[1]!).map(t => t.key)).toEqual(["anchor", "status"]);
  });
});

describe("reference warnings", () => {
  test("kitty's request warns about nothing it quotes", async () => {
    const asked: string[] = [];
    const warnings = await referenceWarnings(KITTY_REQUEST_NOTE, {
      resolve: async text => { asked.push(text); return [{ blockId: QUOTED_TARGET_ID, status: "missing" }]; },
    });
    expect(asked).toEqual([`((${QUOTED_TARGET_ID}|meeting notes))`]);
    expect(warnings.map(w => w.written)).toEqual([`((${QUOTED_TARGET_ID}|meeting notes))`]);
    expect(referenceSuspects(KITTY_REQUEST_NOTE)).toEqual([]);
  });
});

describe("completion", () => {
  test("no trigger in a code span, one being typed, or a fence; one after a closed span", () => {
    expect(cursorInCode(["see `((tran"], 0, 11)).toBe(true);
    expect(cursorInCode(["see `((tran` x"], 0, 11)).toBe(true);
    expect(cursorInCode(["see `code` ((tran"], 0, 17)).toBe(false);
    expect(cursorInCode(["Title", "```", "[[Gar"], 2, 5)).toBe(true);
    expect(cursorInCode(["Title", "```", "x", "```", "[[Gar"], 4, 5)).toBe(false);
    expect(cursorInCode(["> ```", "> ((tr"], 1, 6)).toBe(true);
  });
});
