// Literal regions (PIE-422's door side): between `<!-- literal -->` and `<!-- /literal -->` lines the
// service doesn't parse properties, so the door draws `[key::value]` there as text, hides the matched
// marker lines while reading (not while editing). Both find the regions with outline-core's scan (code-ranges.ts).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { bodyLinesOf, subject, type Msg } from "../src/board";
import { renderDoc } from "../src/doc";
import { literalLines } from "@ep0ch/outline-core/code-ranges";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { outliner } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const note = (text: string): Msg => ({ id: "aaaaaaaa-1111-4222-8333-444444444444", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 2, props: {} });
const host = (): SurfaceHost => ({
  ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
  redraw() {}, navigate() {},
});
const read = (text: string, w = 90) => { const s = new NoteSurface(), h = host(); s.show(note(text), h); return s.render(w, 40, h).lines; };

// Fictional notes covering every rule the scan pins.
const CORPUS = [
  "Seed swap [type::note]\n<!-- literal -->\nBring [crop::beans] and #seeds.\n<!-- /literal -->\nAfter [crop::squash].",
  "<!-- literal -->\nFirst line in a region [x::y]\n<!-- /literal -->",
  "[type::note] [work-id::DEMO-1]\n<!-- literal -->\nPut [stage::queued] on the subject line.\n<!-- /literal -->",
  "Unclosed\n<!-- literal -->\n[a::b] stays a property\n<!-- literal -->\n<!-- /literal -->",
  "Fence shows the syntax\n```\n<!-- literal -->\n```\n[a::b]",
  "Tilde fence\n~~~~\n<!-- literal -->\n~~~\nstill fenced\n~~~~\n[a::b]",
  "Fence inside a region hides its closer\n<!-- literal -->\n```\n<!-- /literal -->\n```\n[k::v]\n<!-- /literal -->\ntail [t::u]",
  "Spacing and case\n   <!--LITERAL-->  \n[a::b]\n<!--   /Literal\t-->",
  "Four spaces is not a marker\n    <!-- literal -->\n[a::b]\n    <!-- /literal -->",
  "Text after the marker\n<!-- literal --> no\n[a::b]\n<!-- /literal -->",
  "CRLF\r\n<!-- literal -->\r\n[a::b]\r\n<!-- /literal -->\r\nafter",
  "Two regions\n<!-- literal -->\n[a::b]\n<!-- /literal -->\nmiddle [m::n]\n<!-- literal -->\n[c::d]\n<!-- /literal -->",
  "No nesting\n<!-- literal -->\n<!-- literal -->\n[a::b]\n<!-- /literal -->\n[c::d]\n<!-- /literal -->",
  "Closer first\n<!-- /literal -->\n[a::b]",
  "",
  "<!-- literal -->",
  "Region at the end\n<!-- literal -->\n<!-- /literal -->",
];

describe.skipIf(!outliner)("the service's literal regions in a title", () => {
  test("a note's title skips marker lines and keeps a region's tokens, as the service's title does", async () => {
    const theirs = await import(join(outliner!, "src/properties.ts"));
    for (const text of CORPUS) {
      const want: string | undefined = theirs.firstLineWithoutPropertyTokens(text)?.trim().replace(/\s+/g, " ");
      if (want === undefined) continue;
      expect({ text, title: subject(note(text)).replace(/\s+/g, " ") }).toEqual({ text, title: want });
    }
  });
});

describe("literal regions in a reader", () => {
  const TEXT = "Allotment brief [season::autumn]\n\nOutside, [level::half] is a property.\n<!-- literal -->\nInside, [mode::loud] is text, and [[Bike shed]] is still a link.\n<!-- /literal -->\nAfter it, [plot::14b] is a property again.";

  test("the marker lines are hidden, a region's [key::value] is drawn as text, and one outside is styled", () => {
    const lines = read(TEXT);
    const text = lines.map(plain);
    expect(text.some(l => l.includes("<!--"))).toBe(false);
    const inside = lines.find(l => plain(l).includes("Inside,"))!;
    const outside = lines.find(l => plain(l).includes("Outside,"))!;
    const after = lines.find(l => plain(l).includes("After it,"))!;
    // Styled, a property's key and value are coloured apart; as text the token reads as one run.
    expect(inside).toContain("[mode::loud]");
    expect(outside).not.toContain("[level::half]");
    expect(plain(outside)).toContain("[level::half]");
    expect(after).not.toContain("[plot::14b]");
    // Links still work inside a region (the service resolves them): drawn as the page's name.
    expect(plain(inside)).toContain("and Bike shed is still a link");
    expect(plain(inside)).not.toContain("[[");
  });

  test("the body keeps its lines: nothing drawn from a marker, the region's text right after the line above it", () => {
    const text = read(TEXT).map(plain).map(l => l.trim());
    const at = text.findIndex(l => l.startsWith("Outside,"));
    expect(text.slice(at, at + 3).map(l => l.split(",")[0])).toEqual(["Outside", "Inside", "After it"]);
  });

  test("editing shows the markers: the source is the note's text as stored", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.startDraft({ ...s.msg!, revision: 2, text: TEXT }, h);
    const text = s.render(90, 40, h).lines.map(plain).join("\n");
    expect(text).toContain("<!-- literal -->");
    expect(text).toContain("<!-- /literal -->");
  });

  test("an opener without a closer protects nothing: its line is drawn as text, properties after it are styled, and the reader says why", () => {
    const lines = read("Unclosed brief\n<!-- literal -->\nStill a property: [mode::loud].");
    const text = lines.map(plain);
    expect(text.some(l => l.includes("⚠ the <!-- literal --> on line 2 has no closing <!-- /literal --> line"))).toBe(true);
    expect(text.some(l => l.trim() === "<!-- literal -->")).toBe(true);
    expect(lines.find(l => plain(l).includes("Still a property"))).not.toContain("[mode::loud]");
  });

  test("a note that opens with a region takes its title from the region's first line, tokens kept; the body starts after it", () => {
    const text = "<!-- literal -->\nUse [stage::queued] on the subject line\nand stage:: doing on its own line.\n<!-- /literal -->\nThat's all.";
    expect(subject(note(text))).toBe("Use [stage::queued] on the subject line");
    const lines = read(text).map(plain).map(l => l.trim());
    expect(lines[1]).toBe("Use [stage::queued] on the subject line");   // under the breadcrumb (PIE-657)
    expect(lines.filter(l => l.includes("Use [stage::queued]"))).toHaveLength(1);   // not drawn again in the body
    expect(lines).toContain("and stage:: doing on its own line.");
  });

  test("block metadata before a region stays out of the title", () => {
    expect(subject(note("[type::note] [work-id::DEMO-1]\n<!-- literal -->\nPut [stage::queued] on the subject line.\n<!-- /literal -->"))).toBe("Put [stage::queued] on the subject line.");
  });

  test("a region inside a callout or a table draws its tokens as text there too", () => {
    const doc = renderDoc("> [!note] Syntax\n> write [k::v] like this\n\n| a | b |\n|---|---|\n| [x::y] | z |", { width: 60, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false, literal: new Set([1, 5]) });
    expect(doc.lines.find(l => plain(l).includes("write"))).toContain("[k::v]");
    expect(doc.lines.find(l => plain(l).includes("[x::y]"))).toContain("[x::y]");
  });

  test("the river's and the search preview's digests hide the markers and keep a region's tokens", () => {
    const body = bodyLinesOf("Seed swap\n<!-- literal -->\nBring [crop::beans].\n<!-- /literal -->\nAfter [crop::squash].");
    expect(body).toEqual([{ text: "Bring [crop::beans].", literal: true }, { text: "After [crop::squash].", literal: false }]);
  });

  test("literalLines names the marker lines, the lines inside, and an unterminated opener by line number", () => {
    expect(literalLines("t\n<!-- literal -->\na\nb\n<!-- /literal -->\nc")).toEqual({ markers: new Set([1, 4]), inside: new Set([2, 3]), unterminated: null });
    expect(literalLines("t\n<!-- literal -->\na")).toEqual({ markers: new Set(), inside: new Set(), unterminated: 1 });
  });
});
