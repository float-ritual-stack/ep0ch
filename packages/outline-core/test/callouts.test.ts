import { describe, expect, test } from "bun:test";
import {
  BUILTIN_CALLOUT_REGISTRY, BUILTIN_CALLOUTS, calloutBlocks, calloutIconFits, calloutRegistry, calloutTypeAtCursor, calloutTypesFromBlocks,
  parseCalloutHeader, quoteDepth, rewriteCalloutHeader,
} from "../src/callouts";

// Obsidian's own examples (https://obsidian.md/help/callouts), as PIE-538 quotes them.
const OBSIDIAN = [
  "> [!question] Can callouts be nested?",
  "> > [!todo] Yes!, they can.",
  "> > > [!example]  You can even use multiple layers of nesting.",
  "",
  "> [!faq]- Are callouts foldable?",
  "> Yes! In a foldable callout, the contents are hidden when the callout is collapsed.",
  "",
  "> [!tip] Title-only callout",
];

describe("callout types: one list", () => {
  test("Obsidian's thirteen types, each alias meaning its type, any case", () => {
    expect(BUILTIN_CALLOUTS.map(t => t.name)).toEqual(["note", "abstract", "info", "todo", "tip", "success", "question", "warning", "failure", "danger", "bug", "example", "quote"]);
    for (const [alias, name] of [["summary", "abstract"], ["TLDR", "abstract"], ["hint", "tip"], ["important", "tip"], ["check", "success"], ["done", "success"], ["help", "question"], ["faq", "question"], ["caution", "warning"], ["attention", "warning"], ["fail", "failure"], ["missing", "failure"], ["error", "danger"], ["cite", "quote"]])
      expect(BUILTIN_CALLOUT_REGISTRY.resolve(alias!)?.name).toBe(name!);
    for (const t of BUILTIN_CALLOUTS) expect(calloutIconFits(t.icon)).toBe(true);
    // Nothing inherited from Object counts as a type.
    expect(BUILTIN_CALLOUT_REGISTRY.resolve("constructor")).toBeNull();
    expect(BUILTIN_CALLOUT_REGISTRY.style("ship-status")).toMatchObject({ name: "ship-status", title: "Ship Status", tone: "neutral" });
  });

  test("an outline declares a type with [callout-type::name] and its icon, tone, title and aliases; mistakes are said, not fatal", () => {
    const { types, problems } = calloutTypesFromBlocks([
      { id: "aaaaaaaa-1", properties: [{ key: "callout-type", value: "Recipe" }, { key: "callout-icon", value: "♨" }, { key: "callout-tone", value: "green" }, { key: "callout-aliases", value: "dish, meal" }] },
      { id: "bbbbbbbb-2", properties: [{ key: "callout-type", value: "warning" }, { key: "callout-tone", value: "coral" }] },
      { id: "cccccccc-3", properties: [{ key: "callout-type", value: "recipe" }] },
      { id: "dddddddd-4", properties: [{ key: "callout-type", value: "harvest" }, { key: "callout-icon", value: "🍅" }, { key: "callout-tone", value: "pink" }, { key: "callout-aliases", value: "hint" }] },
      { id: "eeeeeeee-5", properties: [{ key: "callout-type", value: "has space" }] },
    ]);
    expect(types).toEqual([
      { name: "recipe", title: "Recipe", icon: "♨", tone: "green", aliases: ["dish", "meal"], block: "aaaaaaaa-1" },
      { name: "warning", title: "Warning", icon: "⚠", tone: "coral", aliases: [], block: "bbbbbbbb-2" },
      { name: "harvest", title: "Harvest", icon: "●", tone: "neutral", aliases: [], block: "dddddddd-4" },
    ]);
    expect(problems).toEqual([
      "note cccccccc: callout type recipe is declared already",
      'note dddddddd: callout-icon "🍅" isn\'t one glyph one column wide',
      'note dddddddd: callout-tone "pink" is one of blue, green, violet, amber, coral, neutral',
      "note dddddddd: alias hint already means tip",
      'note eeeeeeee: callout-type "has space" isn\'t a name (letters, digits, - and _)',
    ]);
    const reg = calloutRegistry(types);
    expect(reg.resolve("meal")?.name).toBe("recipe");
    expect(reg.resolve("caution")).toMatchObject({ name: "warning", tone: "coral" });   // restyled, its aliases kept
    expect(reg.types.map(t => t.name).slice(-2)).toEqual(["recipe", "harvest"]);
  });
});

describe("callout grammar", () => {
  test("headers: type, + or -, title; quote depth", () => {
    expect(parseCalloutHeader("[!note] note ")).toEqual({ type: "note", fold: null, title: "note" });
    expect(parseCalloutHeader("[!FAQ]- Are callouts foldable?")).toEqual({ type: "faq", fold: "-", title: "Are callouts foldable?" });
    expect(parseCalloutHeader("[!note]+")).toEqual({ type: "note", fold: "+", title: "" });
    expect(parseCalloutHeader("[!note]title")).toBeNull();
    expect(quoteDepth("> > > [!example]  x")).toEqual({ depth: 3, content: "[!example]  x" });
  });

  test("Obsidian's examples: nested to three levels, folded, title-only", () => {
    expect(calloutBlocks(OBSIDIAN).map(({ line, end, depth, type, fold, title }) => [line, end, depth, type, fold, title])).toEqual([
      [0, 3, 1, "question", null, "Can callouts be nested?"],
      [1, 3, 2, "todo", null, "Yes!, they can."],
      [2, 3, 3, "example", null, "You can even use multiple layers of nesting."],
      [4, 6, 1, "faq", "-", "Are callouts foldable?"],
      [7, 8, 1, "tip", null, "Title-only callout"],
    ]);
    // A callout's header at its own depth ends the one before.
    expect(calloutBlocks(["> [!note] a", "> x", "> [!tip] b", "> y"]).map(b => [b.line, b.end])).toEqual([[0, 2], [2, 4]]);
  });

  test("rewriting a header keeps its quote markers and title", () => {
    expect(rewriteCalloutHeader("> > [!todo] Yes!, they can.", { type: "success" })).toBe("> > [!success] Yes!, they can.");
    expect(rewriteCalloutHeader("> [!faq]- Are callouts foldable?", { fold: "+" })).toBe("> [!faq]+ Are callouts foldable?");
    expect(rewriteCalloutHeader("> [!tip] Title-only callout", { fold: "-" })).toBe("> [!tip]- Title-only callout");
    expect(rewriteCalloutHeader("> [!tip]- x", { fold: null })).toBe("> [!tip] x");
    expect(rewriteCalloutHeader("> plain quote", { type: "tip" })).toBeNull();
  });

  test("the type being typed after > [!", () => {
    expect(calloutTypeAtCursor("> [!wa", 6)).toEqual({ start: 2, end: 6, query: "wa" });
    expect(calloutTypeAtCursor("> > [!", 6)).toEqual({ start: 4, end: 6, query: "" });
    // Through a ] already there.
    expect(calloutTypeAtCursor("> [!wa] Slugs", 6)).toEqual({ start: 2, end: 7, query: "wa" });
    expect(calloutTypeAtCursor("[!wa", 4)).toBeNull();
    expect(calloutTypeAtCursor("> [!warning] Slugs", 18)).toBeNull();
  });
});
