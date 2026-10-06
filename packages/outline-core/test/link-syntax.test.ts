import { expect, test } from "bun:test";
import {
  blockReferenceOccurrences,
  fragmentAnchorMatch,
  linkOccurrences,
  pageAddressReferences,
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

test("referencedBlock unwraps an id or one reference as written (the scan's grammar), and nothing else", () => {
  expect(referencedBlock(` ((${PAINT_ID}|${PAREN_LABEL})) `)).toEqual({ blockId: PAINT_ID });
  expect(referencedBlock(`((${PAINT_ID}^beds))`)).toEqual({ blockId: PAINT_ID, fragment: "beds" });
  // An id's first 8+ characters, as the store and the CLI take them.
  expect(referencedBlock("((dddddddd))")).toEqual({ blockId: "dddddddd" });
  expect(referencedBlock(PAINT_ID)).toEqual({ blockId: PAINT_ID });
  expect(referencedBlock(`((${PAINT_ID})) and more`)).toBeNull();
  expect(referencedBlock("[[Garden]]")).toBeNull();
});
