// Exact selection to source (ADR 0004 contract 5): drawn words found in the source lines they came from, links and
// emphasis read as drawn, the passage widened to whole links. Made-up notes.
import { expect, test } from "bun:test";
import { sourceSpanOf } from "../src/surface/source-map";

const at = (span: string, seen: string) => { const r = sourceSpanOf(span, seen); return r && span.slice(r.from, r.to); };

test("a link drawn by its label is found by its label, and the passage takes the whole link", () => {
  expect(at("Ask ((7d9a1f40-3c52-4b8e|Ana)) about the beans", "Ask Ana about")).toBe("Ask ((7d9a1f40-3c52-4b8e|Ana)) about");
  expect(at("see [[Seed Swap|the swap]] soon", "the swap soon")).toBe("[[Seed Swap|the swap]] soon");
  expect(at("read [the leaflet](https://example.test/x) first", "the leaflet first")).toBe("[the leaflet](https://example.test/x) first");
});

test("emphasis is drawn as style: the marks go with the words they style", () => {
  expect(at("Keep the **soil pH** near 6.5", "the soil pH near")).toBe("the **soil pH** near");
  expect(at("Keep the **soil pH** near 6.5", "soil pH")).toBe("**soil pH**");
});

test("words that aren't there once, or a link drawn by its target's title, aren't exact", () => {
  expect(sourceSpanOf("bean and bean", "bean")).toBeNull();
  expect(sourceSpanOf("see ((7d9a1f40-3c52-4b8e)) now", "see Bike shed now")).toBeNull();
  expect(sourceSpanOf("anything", "  ")).toBeNull();
});
