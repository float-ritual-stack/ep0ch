import { expect, test } from "bun:test";
import { drawAnchors, placeAnchor } from "../src/publish-anchors";
import { renderMarkdownHtml } from "../src/publish";

const drawn = (line: string) => drawAnchors(renderMarkdownHtml(placeAnchor(line, 0)), ["#line:7"]);

// Evan, Nov 5: every published line ending in a bare URL linked to `https://…<span class="line-anchor" …>`.
test("a line ending in a bare URL keeps its link whole, the line's anchor after it", () => {
  for (const line of ["- **Play it:** https://loop-toy.example.org", "See https://example.org/a?b=1", "www.example.org"]) {
    const html = drawn(line);
    expect(html).not.toMatch(/href="[^"]*<span/);
    expect(html).toMatch(/<\/a>\s?<span class="line-anchor" id="line:7"><\/span>/);
  }
  expect(drawn("plain words")).toContain('plain words<span class="line-anchor" id="line:7"></span>');
  expect(drawn("[label](https://example.org)")).toContain('label</a><span class="line-anchor"');
});
