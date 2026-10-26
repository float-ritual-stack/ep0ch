import { describe, expect, test } from "bun:test";
import {
  ensureFragmentAnchor,
  fragmentAnchors,
  fragmentCandidates,
  parseFragmentCompletionQuery,
  resolveFragment,
  resolveFragmentSlice,
  stripFragmentAnchors,
} from "../src/fragments";

const document = [
  "# Stable fragments",
  "",
  "## Durable heading ^durable-heading",
  "Heading content.",
  "",
  "A paragraph that spans",
  "two lines. ^paragraph-note",
  "",
  "## Heading without an anchor",
].join("\n");

test("parses heading and paragraph anchors without changing authored text", () => {
  expect(fragmentAnchors(document)).toEqual([
    {
      id: "durable-heading",
      kind: "heading",
      label: "Durable heading",
      lineIndex: 2,
      markerStart: document.indexOf(" ^durable-heading"),
    },
    {
      id: "paragraph-note",
      kind: "paragraph",
      label: "A paragraph that spans two lines.",
      lineIndex: 6,
      markerStart: document.indexOf(" ^paragraph-note"),
    },
  ]);
  expect(stripFragmentAnchors(document)).toBe(document
    .replace(" ^durable-heading", "")
    .replace(" ^paragraph-note", ""));
});

test("resolves missing and duplicate anchors explicitly", () => {
  expect(resolveFragment(document, "durable-heading")).toMatchObject({
    status: "resolved",
    anchor: { lineIndex: 2, kind: "heading" },
  });
  expect(resolveFragment(document, "missing-anchor")).toEqual({ status: "missing" });
  expect(resolveFragment(`${document}\nDuplicate ^durable-heading`, "durable-heading")).toMatchObject({
    status: "duplicate",
    anchors: [{ lineIndex: 2 }, { lineIndex: 9 }],
  });
});

test("list-item links isolate a step and retain its continuation and nested steps", () => {
  const source = [
    "**Run once, then restore the flag.**",
    "1. [x] Prepare ^prepare",
    "2. [~] Deploy ^deploy",
    "   Keep the deployment receipt.",
    "   - [ ] Verify service ^verify",
    "     Include the response.",
    "3. [ ] Restore ^restore",
    "",
    "Then:",
    "- Ask about ownership ^ask",
  ].join("\r\n");
  expect(resolveFragmentSlice(source, "deploy")).toMatchObject({
    status: "resolved",
    slice: {
      anchor: { kind: "list-item", label: "[~] Deploy" },
      startLine: 2, endLine: 5,
      text: "2. [~] Deploy\n   Keep the deployment receipt.\n   - [ ] Verify service\n     Include the response.",
    },
  });
  expect(resolveFragmentSlice(source, "verify")).toMatchObject({
    status: "resolved",
    slice: { startLine: 4, endLine: 5, text: "   - [ ] Verify service\n     Include the response." },
  });
  expect(resolveFragmentSlice(source, "ask")).toMatchObject({
    status: "resolved", slice: { text: "- Ask about ownership", startLine: 9, endLine: 9 },
  });
});

test("literal example IDs do not make an authored item ambiguous", () => {
  const source = "```markdown\n- [ ] Example ^step\n```\n\n> ```markdown\n> - [ ] Quoted example ^step\n> ```\n\n- [ ] Actual step ^step";
  expect(resolveFragmentSlice(source, "step")).toMatchObject({
    status: "resolved", slice: {text: "- [ ] Actual step"},
  });
});

test("resolves deterministic heading-section and paragraph slices", () => {
  const sliced = [
    "# Document",
    "",
    "## Chosen ^chosen",
    "Chosen body.",
    "",
    "### Nested",
    "Nested body. ^nested-note",
    "",
    "## Next",
    "Next body.",
  ].join("\n");

  expect(resolveFragmentSlice(sliced, "chosen")).toEqual({
    status: "resolved",
    slice: {
      anchor: expect.objectContaining({ id: "chosen", lineIndex: 2 }),
      text: "## Chosen\nChosen body.\n\n### Nested\nNested body.",
      startLine: 2,
      endLine: 7,
    },
  });
  expect(resolveFragmentSlice(sliced, "nested-note")).toEqual({
    status: "resolved",
    slice: {
      anchor: expect.objectContaining({ id: "nested-note", lineIndex: 6 }),
      text: "Nested body.",
      startLine: 6,
      endLine: 6,
    },
  });
  expect(resolveFragmentSlice(sliced, "missing")).toEqual({ status: "missing" });
});

test("offers headings and anchored chunks while exact-id mode excludes unanchored headings", () => {
  expect(fragmentCandidates(document, "heading").map((candidate) => ({
    label: candidate.label,
    fragmentId: candidate.fragmentId,
  }))).toEqual([
    { label: "Durable heading", fragmentId: "durable-heading" },
    { label: "Heading without an anchor", fragmentId: undefined },
  ]);
  expect(fragmentCandidates(document, "paragraph", "id")).toEqual([{
    kind: "paragraph",
    label: "A paragraph that spans two lines.",
    lineIndex: 6,
    fragmentId: "paragraph-note",
  }]);
});

test("creates a stable unique heading anchor only when explicitly requested", () => {
  const first = ensureFragmentAnchor(document, 8);
  expect(first).toEqual({
    text: `${document} ^heading-without-an-anchor`,
    fragmentId: "heading-without-an-anchor",
    created: true,
  });
  expect(ensureFragmentAnchor(first.text, 8)).toEqual({
    text: first.text,
    fragmentId: first.fragmentId,
    created: false,
  });

  const duplicateHeading = `${document}\n\n## Durable heading`;
  expect(ensureFragmentAnchor(duplicateHeading, 10)).toMatchObject({
    fragmentId: "durable-heading-2",
    created: true,
  });
});

test("creates alphanumeric IDs without changing authored line separators", () => {
  const source = "# First\r\n\r\n## _Private\nTail\r\n";
  const created = ensureFragmentAnchor(source, 2);

  expect(created.fragmentId).toBe("private");
  expect(created.text).toBe("# First\r\n\r\n## _Private ^private\nTail\r\n");
  expect(fragmentAnchors(created.text)[0]?.markerStart).toBe(
    created.text.indexOf(" ^private"),
  );
});

test("parses heading-search and durable fragment completion queries", () => {
  expect(parseFragmentCompletionQuery("roadmap#decision")).toEqual({
    blockQuery: "roadmap",
    fragmentQuery: "decision",
    mode: "heading",
  });
  expect(parseFragmentCompletionQuery("block-id^durable")).toEqual({
    blockQuery: "block-id",
    fragmentQuery: "durable",
    mode: "id",
  });
  expect(parseFragmentCompletionQuery("ordinary block")).toBeNull();
});

test("a `#` line inside a code fence is code: it neither ends a heading's section nor is offered as a heading (PIE-424)", () => {
  const source = ["# Notes", "## Setup ^setup", "Run this:", "```sh", "# comment, not a heading", "```", "Then restart.", "## Next"].join("\n");
  expect(resolveFragmentSlice(source, "setup")).toMatchObject({ status: "resolved", slice: { startLine: 1, endLine: 6 } });
  // The anchored heading first (PIE-762), then the others in reading order.
  expect(fragmentCandidates(source, "", "heading").map(candidate => candidate.label)).toEqual(["Setup", "Notes", "Next"]);
});

describe("component anchors (PIE-580)", () => {
  const note = ["Beds [type::plan]", "", "## Where ^where", "::graph-quadrant", "---", "title: Where to put the beds", "xs: [shade, sun]", "---", "- far corner: shade, wet", "", "- **middle: sun, dry**", "::", "^quadrant", "", "A paragraph after. ^after"].join("\n");
  test("an anchor alone on the line after a figure's :: names the figure, by its title", () => {
    expect(fragmentAnchors(note).map(a => [a.id, a.kind, a.label])).toEqual([["where", "heading", "Where"], ["quadrant", "component", "Where to put the beds"], ["after", "paragraph", "A paragraph after."]]);
  });
  test("its slice is the whole block, the blank line inside it included, the anchor's own line left out", () => {
    const r = resolveFragmentSlice(note, "quadrant");
    expect(r.status).toBe("resolved");
    if (r.status !== "resolved") return;
    expect([r.slice.startLine, r.slice.endLine]).toEqual([3, 11]);
    expect(r.slice.text.split("\n")[0]).toBe("::graph-quadrant");
    expect(r.slice.text.split("\n").at(-1)).toBe("::");
    expect(r.slice.text).not.toContain("^quadrant");
  });
  test("an anchor alone after prose, or after an unclosed figure, is the paragraph's as before", () => {
    expect(fragmentAnchors("a line\n^p").map(a => a.kind)).toEqual(["paragraph"]);
    expect(fragmentAnchors("::graph-rank\n- a: 1\n^open").map(a => a.kind)).toEqual(["paragraph"]);
    // A one-line component with arguments has no closing line: not a component anchor.
    expect(fragmentAnchors("::links ((00000000-0000-4000-8000-000000000000))\n^l").map(a => a.kind)).toEqual(["paragraph"]);
  });
});

describe("any element's line takes an anchor (PIE-1247)", () => {
  // A long planning note: a figure with no heading over it, a callout, a list and prose.
  const note = [
    "Spring plan",
    "What goes in when.",
    "",
    "::graph-timeline",
    "---",
    "title: Sowing dates",
    "---",
    "- Mar 3: peas",
    "- Mar 20: beans",
    "::",
    "",
    "> [!tip] Water early",
    "> Before nine, so the leaves dry.",
    "",
    "- stake the peas",
    "- net the brassicas",
    "",
    "::graph-stat",
    "---",
    "query: type=seed",
    "---",
    "::",
  ].join("\n");
  test("a figure with no anchor is offered on its opening line, by its title; choosing it anchors that line and the slice is the whole figure", () => {
    const offered = fragmentCandidates(note, "", "passage").map(c => [c.kind, c.label, c.lineIndex]);
    expect(offered).toContainEqual(["component", "Sowing dates", 3]);
    expect(offered).toContainEqual(["component", "::graph-stat", 17]);
    expect(offered).toContainEqual(["callout", "Water early", 12]);
    expect(offered).toContainEqual(["list-item", "stake the peas", 14]);
    // The figure's own lines are never offered one by one.
    expect(offered.filter(([, , line]) => (line as number) > 3 && (line as number) <= 9)).toEqual([]);
    const at = ensureFragmentAnchor(note, 3);
    expect(at).toMatchObject({ fragmentId: "sowing-dates", created: true });
    expect(at.text.split("\n")[3]).toBe("::graph-timeline ^sowing-dates");
    expect(fragmentAnchors(at.text).map(a => [a.id, a.kind, a.label])).toEqual([["sowing-dates", "component", "Sowing dates"]]);
    const r = resolveFragmentSlice(at.text, "sowing-dates");
    expect(r.status === "resolved" && [r.slice.startLine, r.slice.endLine, r.slice.text]).toEqual([3, 9, note.split("\n").slice(3, 10).join("\n")]);
    // Anchored, it's offered as the anchor it has, not again as a passage to add one to.
    expect(fragmentCandidates(at.text, "", "passage").filter(c => c.lineIndex === 3).map(c => c.fragmentId)).toEqual(["sowing-dates"]);
    // A figure with no title takes its kind's name.
    expect(ensureFragmentAnchor(note, 17).fragmentId).toBe("graph-stat");
  });
  test("a callout anchored on its head line is the whole callout's, as one on its last line is", () => {
    const tip = "Tips\n\n> [!tip] Water early ^water\n> Before nine, so the leaves dry.\n\n> Plain quote ^first-line\n> second line";
    expect(fragmentAnchors(tip).map(a => [a.id, a.kind, a.label])).toEqual([["water", "callout", "Water early"], ["first-line", "paragraph", "> Plain quote"]]);
    const r = resolveFragmentSlice(tip, "water");
    expect(r.status === "resolved" && r.slice.text).toBe("> [!tip] Water early\n> Before nine, so the leaves dry.");
    expect(fragmentCandidates(tip, "", "passage").filter(c => c.kind === "callout").map(c => c.fragmentId)).toEqual(["water"]);
  });
  test("a one-line component with arguments takes one too, and the old form after the :: still names its figure", () => {
    const links = "Index\n\n::links ((00000000-0000-4000-8000-000000000000)) ^more";
    expect(fragmentAnchors(links).map(a => [a.id, a.kind])).toEqual([["more", "component"]]);
    const r = resolveFragmentSlice(links, "more");
    expect(r.status === "resolved" && r.slice.text).toBe("::links ((00000000-0000-4000-8000-000000000000))");
    const old = "Beds\n\n::graph-rank\n- a: 1\n::\n^rank";
    expect(fragmentAnchors(old).map(a => a.kind)).toEqual(["component"]);
    expect(fragmentCandidates(old, "", "passage").filter(c => !c.fragmentId && c.kind === "component")).toEqual([]);
  });
  test("a component inside another is part of it: only the outer one is offered", () => {
    const boxed = "Box\n\n::box{pad=1}\n::graph-stat\n---\nquery: type=seed\n---\n::\n::";
    expect(fragmentCandidates(boxed, "", "passage").filter(c => c.kind === "component").map(c => c.lineIndex)).toEqual([2]);
  });
});

describe("quotes and callouts (PIE-592): one passage each, embedded whole", () => {
  const note = [
    "Bike shed",
    "The shed by the gate.",
    "",
    "> The latch sticks in the rain.",
    "> Lift it before you pull.",
    "",
    "> [!note] Keys",
    "> One key is under the pot.",
    ">",
    "> The other is with Mo.",
    "",
    "## Paint",
    "Green, two coats.",
  ].join("\n");
  test("offered as a quote and a callout (by its title), never line by line; choosing one anchors its last line and the slice is all of it", () => {
    const offered = fragmentCandidates(note, "", "passage").map(c => [c.kind, c.label, c.lineIndex]);
    expect(offered).toContainEqual(["quote", "The latch sticks in the rain. Lift it before you pull.", 4]);
    expect(offered).toContainEqual(["callout", "Keys", 9]);
    expect(offered.filter(([, , line]) => (line as number) >= 3 && (line as number) <= 9)).toHaveLength(2);
    const quote = ensureFragmentAnchor(note, 4), callout = ensureFragmentAnchor(quote.text, 9);
    expect([quote.fragmentId, callout.fragmentId]).toEqual(["the-latch-sticks", "keys"]);
    expect(callout.text.split("\n")[9]).toBe("> The other is with Mo. ^keys");
    expect(fragmentAnchors(callout.text).map(a => [a.id, a.kind, a.label])).toEqual([
      ["the-latch-sticks", "quote", "The latch sticks in the rain. Lift it before you pull."],
      ["keys", "callout", "Keys"],
    ]);
    const slice = resolveFragmentSlice(callout.text, "keys");
    expect(slice.status === "resolved" && slice.slice.text).toBe("> [!note] Keys\n> One key is under the pot.\n>\n> The other is with Mo.");
    const whole = resolveFragmentSlice(callout.text, "the-latch-sticks");
    expect(whole.status === "resolved" && whole.slice.text).toBe("> The latch sticks in the rain.\n> Lift it before you pull.");
  });
  test("a quote ending in a list item is still the whole quote's; an anchor mid-quote leaves the whole quote offered", () => {
    const listed = "Note\n\n> Intro\n> - Last item";
    const at = ensureFragmentAnchor(listed, 3);
    expect(fragmentAnchors(at.text).map(a => a.kind)).toEqual(["quote"]);
    const r = resolveFragmentSlice(at.text, at.fragmentId);
    expect(r.status === "resolved" && r.slice.text).toBe("> Intro\n> - Last item");
    const mid = "Note\n\n> First paragraph ^first\n>\n> Second paragraph";
    expect(fragmentCandidates(mid, "", "passage").map(c => [c.kind, c.lineIndex])).toContainEqual(["quote", 4]);
  });
});

test("a front-matter property line takes no anchor (it would become part of its value); a body line does", () => {
  const text = ["Sowing notes [type::note]", "- re:: whether to sow early", "", "Sow the beans in May."].join("\n");
  expect(() => ensureFragmentAnchor(text, 1)).toThrow(/front-matter property/);
  expect(() => ensureFragmentAnchor(["Sowing notes", "- [re::whether to sow early]", "", "Body."].join("\n"), 1)).toThrow(/front-matter property/);
  expect(() => ensureFragmentAnchor(["Sowing notes", "- [re::whether to sow early]", "", "Body."].join("\n"), 1)).toThrow(/front-matter property/);
  expect(ensureFragmentAnchor(text, 3)).toMatchObject({ created: true });
});
