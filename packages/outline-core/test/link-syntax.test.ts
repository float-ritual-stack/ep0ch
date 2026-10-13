import { expect, test } from "bun:test";
import {
  blockReferenceOccurrences,
  fragmentAnchorMatch,
  linkOccurrences,
  pageAddressReferences,
  pageAddressText,
  pageLinkRanges,
  referencedBlock,
  withoutFragmentAnchor,
} from "../src/link-syntax";
import { ANCHOR_LINES, BLANK_LABEL_NOTE, BLANK_LABEL_PAGES, PAINT_ID, PAREN_LABEL, PAREN_LABEL_NOTE } from "./fixtures/link-notes";

test("a reference's label runs to the )) that balances its parentheses", () => {
  const [ref] = blockReferenceOccurrences(PAREN_LABEL_NOTE);
  expect(ref).toMatchObject({ blockId: PAINT_ID, label: PAREN_LABEL });
  expect(PAREN_LABEL_NOTE.slice(ref!.end)).toBe(" before the first coat.");
});

test("a blank label makes no link: a page's stays text, a reference's too", () => {
  expect(pageAddressReferences(BLANK_LABEL_NOTE).map(p => ({ address: p.displayAddress, label: p.label }))).toEqual(BLANK_LABEL_PAGES);
  expect(blockReferenceOccurrences(`((${PAINT_ID}| ))`)).toEqual([]);
});

test("the fragment anchor rule: after any blank or alone on its line, blanks after it allowed", () => {
  for (const [line, id] of ANCHOR_LINES) expect({ line, id: fragmentAnchorMatch(line)?.[1] ?? null }).toEqual({ line, id });
  expect(withoutFragmentAnchor("Stake the peas ^peas  ")).toBe("Stake the peas");
  expect(withoutFragmentAnchor("Ratio 2^8")).toBe("Ratio 2^8");
});

test("a note's links in reading order: an embed starts at its !, a link in a Markdown link's text or an image's is its text", () => {
  const text = `![photo ((${PAINT_ID}))](shed.png) [see ((${PAINT_ID}))](https://example.org) !((${PAINT_ID})) !((${PAINT_ID}|labelled)) ((${PAINT_ID}|has [[Page]] in it)) ((${PAINT_ID}|[docs](https://example.org))) [[Page]]`;
  expect(linkOccurrences(text).map(l => [l.kind, text.slice(l.start, l.end), l.kind === "block" ? l.embed : null])).toEqual([
    ["markdown", `[see ((${PAINT_ID}))](https://example.org)`, null],
    ["block", `!((${PAINT_ID}))`, true],
    ["block", `((${PAINT_ID}|labelled))`, false],
    ["block", `((${PAINT_ID}|has [[Page]] in it))`, false],
    ["block", `((${PAINT_ID}|[docs](https://example.org)))`, false],
    ["page", "[[Page]]", null],
  ]);
});

test("brackets are counted: a page link holding another is one link to its whole address, and links both (PIE-592)", () => {
  const text = "See [[[[2026-10-06]] - editor thoughts]] and [[Shed|the shed]].";
  expect(pageAddressReferences(text).map(p => [p.displayAddress, p.label ?? null, !!p.nested])).toEqual([
    ["[[2026-10-06]] - editor thoughts", null, false],
    ["2026-10-06", null, true],
    ["Shed", "the shed", false],
  ]);
  // Drawn as one link, the one that holds the other; it reads without the inner brackets.
  expect(linkOccurrences(text).map(l => text.slice(l.start, l.end))).toEqual(["[[[[2026-10-06]] - editor thoughts]]", "[[Shed|the shed]]"]);
  expect(pageAddressText("[[2026-10-06]] - editor thoughts")).toBe("2026-10-06 - editor thoughts");
  // A stray ] still makes no page; a [[ left open at the line's end leaves the links it held standing.
  expect(pageAddressReferences("[[a]b]]").map(p => p.displayAddress)).toEqual([]);
  expect(pageAddressReferences("[[[[Shed]] notes\nnext").map(p => p.displayAddress)).toEqual(["Shed"]);
  expect(pageLinkRanges("[[unfinished [[a #tag]]")).toEqual([{ start: 13, end: 23 }]);
  // Brackets in code are text: they never pair with a link outside it.
  expect(linkOccurrences("`[[` [[a]] `]]`").map(l => l.kind === "page" && l.displayAddress)).toEqual(["a"]);
  // Many links on a line stay quick (no scan of every earlier link per link).
  const many = "[[a]] ".repeat(20000), t0 = performance.now();
  expect(pageAddressReferences(many)).toHaveLength(20000);
  expect(performance.now() - t0).toBeLessThan(1000);
});

test("referencedBlock unwraps an id or one reference as written (the scan's grammar), and nothing else", () => {
  expect(referencedBlock(` ((${PAINT_ID}|${PAREN_LABEL})) `)).toEqual({ blockId: PAINT_ID });
  expect(referencedBlock(`((${PAINT_ID}^beds))`)).toEqual({ blockId: PAINT_ID, fragment: "beds" });
  // An id's first 8+ characters, as the store and the CLI take them.
  expect(referencedBlock("((dddddddd))")).toEqual({ blockId: "dddddddd" });
  expect(referencedBlock(PAINT_ID)).toEqual({ blockId: PAINT_ID });
  expect(referencedBlock(`((${PAINT_ID})) and more`)).toBeNull();
  expect(referencedBlock("[[Garden]]")).toBeNull();
});
