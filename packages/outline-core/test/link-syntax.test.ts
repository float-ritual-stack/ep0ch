import { expect, test } from "bun:test";
import { propertyValueLinks } from "../src/property-grammar";
import {
  blockRefText,
  blockReferenceOccurrences,
  embedOccurrences,
  embeddedPageAddress,
  fragmentAnchorMatch,
  linkOccurrences,
  pageAddressReferences,
  pageAddressText,
  pageLinkRanges,
  referencesToResolve,
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
  expect(referencedBlock(` ((${PAINT_ID}|${PAREN_LABEL})) `)).toEqual({ blockId: PAINT_ID, label: PAREN_LABEL });
  expect(referencedBlock(`((${PAINT_ID}^beds))`)).toEqual({ blockId: PAINT_ID, fragment: "beds" });
  // An id's first 8+ characters, as the store and the CLI take them.
  expect(referencedBlock("((dddddddd))")).toEqual({ blockId: "dddddddd" });
  expect(referencedBlock(PAINT_ID)).toEqual({ blockId: PAINT_ID });
  expect(referencedBlock(`((${PAINT_ID})) and more`)).toBeNull();
  expect(referencedBlock("[[Garden]]")).toBeNull();
});

// PIE-874: links written inside property values, the one scan every client and the service read them by.
test("links inside property values: references and page links anywhere in a value, an item that is exactly a ticket key, the address keys skipped", () => {
  const text = "Walk [via::[[X-2]]] [ticket::PC-582] [related::[((c0ffee00-1111-4222-8333-444444444444)), notes, PIE-12]] [status::done] [page::Walk] [work-id::PIE-9]\nnext:: see [[Beds]]";
  const links = propertyValueLinks(text).map(l => [l.key, l.kind === "ticket" ? l.workId : l.kind, text.slice(l.reference.start, l.reference.end)]);
  expect(links).toEqual([
    ["via", "page", "[[X-2]]"],
    ["ticket", "PC-582", "PC-582"],
    ["related", "block", "((c0ffee00-1111-4222-8333-444444444444))"],
    ["related", "PIE-12", "PIE-12"],
  ]);
  // A value's words that merely look like something stay text; a bare `key:: value` line's links count when its tokens are given.
  expect(propertyValueLinks("[note::FM-1 is a synth]")).toEqual([]);
  // With the outline's prefixes, its Work IDs in a value's words link, never one in a link's own label; skip= leaves a key out.
  const words = "[waiting-on::review of PIE-012 and ((c0ffee00-1111-4222-8333-444444444444|PIE-013))] [jira::PIE-014]";
  expect(propertyValueLinks(words, undefined, { prefixes: "PIE", skip: k => k === "jira" }).map(l => l.kind === "ticket" ? l.workId : l.kind)).toEqual(["PIE-012", "block"]);
  expect(propertyValueLinks("next:: see [[Beds]]", [{ key: "next", start: 0, raw: "next:: see [[Beds]]" }]).map(l => l.kind)).toEqual(["page"]);
});

test("a page link points into its page with ^anchor, and ![[…]] embeds it, as ((id^anchor)) and !((…)) do (PIE-1247)", () => {
  const [plain, anchored, labelled] = pageAddressReferences("[[Spring plan]] [[Spring plan^sowing]] [[Spring plan ^water|the tip]]");
  expect(plain).toMatchObject({ displayAddress: "Spring plan", normalizedAddress: "spring plan" });
  expect(plain!.fragmentId).toBeUndefined();
  expect(anchored).toMatchObject({ displayAddress: "Spring plan", normalizedAddress: "spring plan", fragmentId: "sowing" });
  expect(labelled).toMatchObject({ displayAddress: "Spring plan", fragmentId: "water", label: "the tip" });
  // A `^` that isn't an anchor at the address's end is the address's own; a link that is only `^anchor` names that page.
  expect(pageAddressReferences("[[2^10 grains]] [[^lonely]]").map(r => [r.displayAddress, r.fragmentId])).toEqual([["2^10 grains", undefined], ["^lonely", undefined]]);
  const line = "See ![[Spring plan^sowing]] and !((a1b2c3d4-0000-4000-8000-000000000000^water)), not `![[Code^x]]` or ![[Labelled|no]].";
  const embeds = embedOccurrences(line, "inline");
  expect(embeds.map(e => [line.slice(e.start, e.end), e.target, e.fragmentId])).toEqual([
    ["![[Spring plan^sowing]]", "[[Spring plan]]", "sowing"],
    ["!((a1b2c3d4-0000-4000-8000-000000000000^water))", "a1b2c3d4-0000-4000-8000-000000000000", "water"],
  ]);
  expect(embeds.map(e => embeddedPageAddress(e.target))).toEqual(["Spring plan", null]);
  expect(linkOccurrences(line, "inline").filter(l => l.kind === "page").map(l => [l.kind === "page" && l.embed, line[l.start]])).toEqual([[true, "!"], [false, "["]]);
});

test("blockRefText writes what the scan reads back: another outline's prefix, a line's anchor and a label that can't end it early", () => {
  expect(blockRefText(PAINT_ID, "Paint (the shed)|first")).toBe(`((${PAINT_ID}|Paint the shed first))`);
  const written = blockRefText(PAINT_ID, "Paint the shed", { outline: "orchard", fragment: "coats" });
  expect(written).toBe(`((orchard:${PAINT_ID}^coats|Paint the shed))`);
  expect(referencedBlock(written)).toEqual({ blockId: PAINT_ID, outline: "orchard", fragment: "coats", label: "Paint the shed" });
  expect(referencedBlock(blockRefText(PAINT_ID, "", { fragment: "coats" }))).toEqual({ blockId: PAINT_ID, fragment: "coats" });
});

test("a figure's cells name notes to resolve; its code doesn't (PIE-1334)", () => {
  const note = ["Asks", "", "::graph-table", "---", "rows:", '  - ["((0a1b2c3d|the shed)) x", "`((9f8e7d6c))`"]', "---", "::", "", "```", "((1a2b3c4d))", "```"].join("\n");
  expect(blockReferenceOccurrences(note)).toEqual([]);
  expect(referencesToResolve(note).map(r => r.blockId)).toEqual(["0a1b2c3d"]);
});
