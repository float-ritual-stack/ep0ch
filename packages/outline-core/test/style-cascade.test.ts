import { describe, expect, test } from "bun:test";
import { componentBlocks } from "../src/component-block";
import { headingStylesFromBlocks } from "../src/heading-styles";
import {
  BASE_STYLE, headingComponentLayer, listLayers, listOwners, listStart, nudgeStyleValue, parseStyleAttrs, parseStyleTarget, resolveStyle, styleDeclarationLine,
  styleLayers, styleProperty, styleSheetsFromBlocks, styleValueText, type StyleLayer,
} from "../src/style-cascade";

const props = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value }));

describe("the cascade", () => {
  const sheets = styleSheetsFromBlocks([
    { id: "aaaa0001", properties: props({ "style-for": "global", "style.margin.x": "3", "style.list.gap": "1" }) },
    { id: "aaaa0002", properties: props({ "style-for": "tile:detail", "style.margin.x": "5", "style.narrow.margin.x": "0" }) },
    { id: "aaaa0003", properties: props({ "style-for": "screen:desk", "style.list.zebra": "on" }) },
    { id: "aaaa0004", properties: props({ "style-for": "airy", "style.list.gap": "2" }) },
  ]);

  test("nearest wins, and every value says where it came from", () => {
    expect(sheets.problems).toEqual([]);
    const layers = styleLayers(sheets.sheets, { tile: "detail", screen: "desk", page: { id: "pppp", properties: props({ style: "airy", "style.pad.y": "1" }) } });
    const r = resolveStyle(layers, 80);
    expect(r.values["margin.x"]).toBe(5);
    expect(r.sources["margin.x"]).toMatchObject({ level: "tile", label: "tile detail", block: "aaaa0002" });
    expect(r.values["list.gap"]).toBe(2);
    expect(r.sources["list.gap"]).toMatchObject({ level: "page", label: "style airy" });
    expect(r.values["list.zebra"]).toBe(true);
    expect(r.values["pad.y"]).toBe(1);
    expect(r.sources["pad.y"]).toMatchObject({ level: "page", label: "page", block: "pppp" });
    // The reader's own default: a measure of 88, under everything the outline says.
    expect(r.values.measure).toBe(88);
    expect(r.sources.measure).toMatchObject({ level: "base", label: "built-in detail" });
    expect(r.sources["pad.x"]).toMatchObject({ level: "base", label: "built-in" });
  });

  test("a width variant beats its level's plain value while the tile is that wide, at 40, 80 and 160 columns", () => {
    const layers = styleLayers(sheets.sheets, { tile: "detail" });
    expect(resolveStyle(layers, 40)).toMatchObject({ breakpoint: "narrow", values: { "margin.x": 0 } });
    expect(resolveStyle(layers, 40).sources["margin.x"]).toMatchObject({ level: "tile", variant: "narrow" });
    expect(resolveStyle(layers, 80)).toMatchObject({ breakpoint: null, values: { "margin.x": 5 } });
    expect(resolveStyle(layers, 160)).toMatchObject({ breakpoint: "wide", values: { "margin.x": 5 } });
    // A nearer level's plain value still beats a farther level's variant.
    const page: StyleLayer = { level: "page", label: "page", fields: { "margin.x": "2" } };
    expect(resolveStyle([...layers, page], 40).values["margin.x"]).toBe(2);
  });

  test("the breakpoints are tokens too", () => {
    const layers: StyleLayer[] = [{ level: "global", label: "global", fields: { "bp.narrow": "100", "narrow.list.gap": "3" } }];
    expect(resolveStyle(layers, 80)).toMatchObject({ breakpoint: "narrow", values: { "list.gap": 3 } });
    expect(resolveStyle(layers, 120)).toMatchObject({ breakpoint: null, values: { "list.gap": 0 } });
  });

  test("a value that can't be used is said, and the level below stands", () => {
    const layers: StyleLayer[] = [
      { level: "global", label: "global", fields: { "margin.x": "2" } },
      { level: "page", label: "page", fields: { "margin.x": "lots", "list.divider": "wavy" } },
    ];
    const r = resolveStyle(layers, 80);
    expect(r.values["margin.x"]).toBe(2);
    expect(r.values["list.divider"]).toBe("none");
    expect(r.problems).toEqual(['page: margin.x "lots" is a whole number, 0 to 24', 'page: list.divider "wavy" is one of none, line, dots, dashed, double, fade, glyph']);
  });

  test("an undeclared named style is said", () => {
    const problems: string[] = [];
    styleLayers([], { page: { id: "p", properties: props({ style: "nope" }) } }, problems);
    expect(problems[0]).toContain('style "nope" isn\'t declared');
  });
});

describe("declarations", () => {
  test("targets", () => {
    expect(parseStyleTarget("global")).toEqual({ level: "global" });
    expect(parseStyleTarget("tile:detail")).toEqual({ level: "tile", name: "detail" });
    expect(parseStyleTarget("Screen:desk")).toEqual({ level: "screen", name: "desk" });
    expect(parseStyleTarget("airy")).toEqual({ level: "named", name: "airy" });
    expect(parseStyleTarget("page")).toBeNull();
    expect(parseStyleTarget("tile:")).toBeNull();
  });

  test("a line declares one with its own tokens; a code span declares nothing", () => {
    expect(styleDeclarationLine("Reading comfort [style-for::global] [style.measure::72]")).toMatchObject({ for: "global", fields: { measure: "72" } });
    expect(styleDeclarationLine("`[style-for::global]` is how")).toBeNull();
  });

  test("pad and margin set both axes, one row to two columns (cells are twice as tall as wide)", () => {
    const { sheets } = styleSheetsFromBlocks([{ id: "x", properties: props({ "style-for": "global", "style.pad": "1", "style.margin": "1 3", "style.narrow.pad": "0" }) }]);
    expect(sheets[0]!.fields).toEqual({ "pad.y": "1", "pad.x": "2", "margin.y": "1", "margin.x": "3", "narrow.pad.y": "0", "narrow.pad.x": "0" });
  });

  test("a key that isn't a token is said", () => {
    const r = styleSheetsFromBlocks([{ id: "abcdef12", properties: props({ "style-for": "global", "style.padd.x": "1" }) }]);
    expect(r.problems[0]).toStartWith("note abcdef12: style.padd.x isn't a style token");
  });
});

describe("one system with heading styles (PIE-599)", () => {
  test("heading-margin on a style note is the cascade's heading.margin, by the same grammar", () => {
    const { sheets } = styleSheetsFromBlocks([{ id: "x", properties: props({ "style-for": "global", "heading-margin": "1 0 2" }) }]);
    const r = resolveStyle(styleLayers(sheets, {}), 80);
    expect(r.values["heading.margin"]).toEqual({ top: 1, cols: 0, bottom: 2 });
  });

  test("a heading style is the component level: under the outline's levels, over the base", () => {
    const { styles } = headingStylesFromBlocks([{ id: "hs", properties: props({ "heading-style": "airy", "heading-margin": "2 4 1" }) }]);
    const comp = headingComponentLayer(styles[0]!);
    expect(resolveStyle([comp], 80).values["heading.margin"]).toEqual({ top: 2, cols: 4, bottom: 1 });
    expect(resolveStyle([comp], 80).sources["heading.margin"]).toMatchObject({ level: "component", label: "heading airy", block: "hs" });
    const global: StyleLayer = { level: "global", label: "global", fields: { "heading.margin": "1" } };
    // "1" is columns, the rows kept from the base (0 0): the grammar heading-margin always had.
    expect(resolveStyle([comp, global], 80).values["heading.margin"]).toEqual({ top: 0, cols: 1, bottom: 0 });
  });

  test("an existing heading style declaration still reads as it did", () => {
    const { styles, problems } = headingStylesFromBlocks([{ id: "hs", properties: props({ "heading-style": "plot", "heading-margin": "9 0 1", "heading-padding": "1 3" }) }]);
    expect(styles[0]).toMatchObject({ margin: { top: 3, cols: 0, bottom: 1 }, padding: { rows: 1, cols: 3 } });
    expect(problems[0]).toContain("at most 3 rows");
  });
});

describe("a box's attributes (PIE-549's syntax)", () => {
  test("tokens, shorthands, variants, a bare flag and classes", () => {
    expect(parseStyleAttrs("margin.x=2 list.zebra narrow.list.gap=0 pad=1 .accent border=round")).toEqual({
      fields: { "margin.x": "2", "list.zebra": "on", "narrow.list.gap": "0", "pad.y": "1", "pad.x": "2", border: "round" }, classes: ["accent"], problems: [],
    });
    expect(parseStyleAttrs('pad="1 3" nope=1').fields).toEqual({ "pad.y": "1", "pad.x": "3" });
    expect(parseStyleAttrs("nope=1").problems).toEqual(["box: nope isn't a style token"]);
  });

  test("a box opens with its attributes straight after the name and closes with ::", () => {
    expect(componentBlocks(["intro", "::box{list.gap=1 margin.x=4}", "- one", "- two", "::", "after"])).toEqual([
      { name: "box", args: null, start: 1, end: 4, attrs: "list.gap=1 margin.x=4" },
    ]);
    // Unclosed, it is text, as any component is.
    expect(componentBlocks(["::box{pad=1}", "- one"])).toEqual([]);
  });
});

describe("nudging", () => {
  test("by the token's step: a column pair for x, one row for y, a choice cycles", () => {
    expect(nudgeStyleValue("pad.x", 2, 1)).toBe(4);
    expect(nudgeStyleValue("pad.y", 0, 1)).toBe(1);
    expect(nudgeStyleValue("pad.y", 0, -1)).toBe(0);
    expect(nudgeStyleValue("measure", 0, 1)).toBe(40);
    expect(nudgeStyleValue("measure", 88, -1)).toBe(84);
    expect(nudgeStyleValue("list.zebra", false, 1)).toBe(true);
    expect(nudgeStyleValue("list.divider", "none", 1)).toBe("line");
    expect(nudgeStyleValue("list.divider", "none", -1)).toBe("glyph");
    expect(nudgeStyleValue("heading.padding", { rows: 0, cols: 2 }, 1)).toEqual({ rows: 1, cols: 4 });
  });

  test("values write back as they're read", () => {
    expect(styleValueText(true)).toBe("on");
    expect(styleValueText({ top: 1, cols: 0, bottom: 2 })).toBe("1 0 2");
    expect(styleProperty("margin.x", "narrow")).toBe("style.narrow.margin.x");
    expect(BASE_STYLE["margin.x"]).toBe(1);
  });
});

describe("surfaces, frames and the header (PIE-675)", () => {
  test("a box's colours and frame are style fields; a role or tone, never a colour", () => {
    const a = parseStyleAttrs("bg=amber bg.strength=3 border=round edge=bar tone=violet");
    expect(a).toMatchObject({ fields: { bg: "amber", "bg.strength": "3", border: "round", edge: "bar", tone: "violet" }, problems: [] });
    const r = resolveStyle([{ level: "block", label: "box", fields: a.fields }], 80);
    expect(r.values).toMatchObject({ bg: "amber", "bg.strength": 3, border: "round", edge: "bar", tone: "violet" });
    const bad = resolveStyle([{ level: "page", label: "page", fields: { bg: "#ffffff", "bg.strength": "9", border: "dotted" } }], 80);
    expect(bad.values).toMatchObject({ bg: "none", "bg.strength": 2, border: "auto" });
    expect(bad.problems).toHaveLength(3);
  });

  test("dividers: their styles, a glyph of one's own, where they sit; zebra's surface and strength", () => {
    const r = resolveStyle([{ level: "global", label: "global", fields: { "list.divider": "glyph", "list.divider.glyph": "✦", "list.divider.align": "center", "list.zebra.bg": "sunken", "list.zebra.strength": "4" } }], 80);
    expect(r.values).toMatchObject({ "list.divider": "glyph", "list.divider.glyph": "✦", "list.divider.align": "centre", "list.zebra.bg": "sunken", "list.zebra.strength": 4 });
    expect(BASE_STYLE).toMatchObject({ "list.divider.align": "centre", "list.zebra.bg": "raised", "list.zebra.strength": 2, bg: "none", border: "auto", edge: "none", tone: "neutral" });
    expect(resolveStyle([{ level: "page", label: "page", fields: { "list.zebra.bg": "none" } }], 80).values["list.zebra.bg"]).toBe("raised");
    // A glyph's nudge steps through the presets; anything else is written by hand.
    expect(nudgeStyleValue("list.divider.glyph", "·", 1)).toBe("•");
    expect(nudgeStyleValue("list.divider.glyph", "@", 1)).toBe("·");
    expect(resolveStyle([{ level: "page", label: "page", fields: { "list.divider.glyph": "]" } }], 80).problems).toHaveLength(1);
  });

  test("the header: its surface and opacity, its picture over the hero (as written), and the crop's offsets", () => {
    const sheets = styleSheetsFromBlocks([{ id: "hhhh0001", properties: props({ "style-for": "tile:detail", "style.header.bg": "blue", "style.header.bg.opacity": "40", "style.header.image": "media/Shed Door.png", "style.header.image.x": "-15" }) }]);
    expect(sheets.problems).toEqual([]);
    const r = resolveStyle(styleLayers(sheets.sheets, { tile: "detail" }), 80);
    expect(r.values).toMatchObject({ "header.bg": "blue", "header.bg.opacity": 40, "header.image": "media/Shed Door.png", "header.image.x": -15, "header.image.y": 0 });
    expect(nudgeStyleValue("header.image.y", 0, -1)).toBe(-5);
    expect(nudgeStyleValue("header.image.x", 50, 1)).toBe(50);
  });

  test("tier-keyed values: narrow | normal | wide in one field, its written variant winning", () => {
    const sheets = styleSheetsFromBlocks([
      { id: "tttt0001", properties: props({ "style-for": "global", "style.pad": "0 1 | 1 3 | 1 6", "style.bg": "none | raised | sunken", "style.wide.bg": "amber" }) },
    ]);
    expect(sheets.problems).toEqual([]);
    const at = (w: number) => resolveStyle(styleLayers(sheets.sheets, {}), w).values;
    expect(at(40)).toMatchObject({ "pad.y": 0, "pad.x": 1, bg: "none" });
    expect(at(80)).toMatchObject({ "pad.y": 1, "pad.x": 3, bg: "raised" });
    expect(at(160)).toMatchObject({ "pad.y": 1, "pad.x": 6, bg: "amber" });
    expect(styleSheetsFromBlocks([{ id: "tttt0002", properties: props({ "style-for": "global", "style.list.gap": "0 | 1" }) }]).problems[0]).toContain("three values");
    // Written out beats a shorthand beats a tier's written out beats a tier's shorthand, in either order on the note.
    for (const order of [0, 1]) {
      const fields = [["style.pad", "0 1 | 1 3 | 1 6"], ["style.wide.pad", "2 9"], ["style.pad.x", "5 | 7 | 8"], ["style.narrow.pad.y", "3"]] as [string, string][];
      const sheet = styleSheetsFromBlocks([{ id: "tttt0003", properties: [{ key: "style-for", value: "global" }, ...(order ? fields.reverse() : fields).map(([key, value]) => ({ key, value }))] }]);
      expect(sheet.problems).toEqual([]);
      const v = (w: number) => resolveStyle(styleLayers(sheet.sheets, {}), w).values;
      expect(v(160)).toMatchObject({ "pad.y": 2, "pad.x": 9 });
      expect(v(80)).toMatchObject({ "pad.y": 1, "pad.x": 7 });
      expect(v(40)).toMatchObject({ "pad.y": 3, "pad.x": 5 });
    }
  });

  test("a reader, wide, gets padding 1 4 by its kind's own default; narrower, none", () => {
    expect(resolveStyle(styleLayers([], { tile: "detail" }), 160).values).toMatchObject({ "pad.y": 1, "pad.x": 4 });
    expect(resolveStyle(styleLayers([], { tile: "detail" }), 100).values).toMatchObject({ "pad.y": 0, "pad.x": 0 });
    expect(resolveStyle(styleLayers([], { tile: "backlinks" }), 160).values).toMatchObject({ "pad.y": 0, "pad.x": 0 });
  });
});

describe("this tile and this list (PIE-675)", () => {
  test("this tile is over the page, under a block; a list's own over this tile", () => {
    const layers = styleLayers([], { tile: "backlinks", page: { id: "p", properties: props({ "style.list.gap": "0" }) }, instance: { id: "t4", fields: { "list.gap": "2" } } });
    const r = resolveStyle(layers, 80);
    expect(r.values["list.gap"]).toBe(2);
    expect(r.sources["list.gap"]).toMatchObject({ level: "instance", label: "this tile" });
    const lines = ["## Seed trays [style.list.gap::1]", "- Tomatoes", "- Chillies"];
    const own = resolveStyle([...layers, ...listLayers(lines, 1, "n1")], 80);
    expect(own.values["list.gap"]).toBe(1);
    expect(own.sources["list.gap"]).toMatchObject({ level: "block", label: "this list", block: "n1", line: 0 });
  });

  test("a list's owners by placement: its lead-in line, else its section's heading; only its list fields count", () => {
    const lines = [
      "## Beds [style.list.divider::dots]",   // 0
      "Climbers: [style.list.gap::2] [style.margin.x::9]", // 1
      "- runner beans",                      // 2
      "  up the canes",                      // 3
      "",                                    // 4
      "- sweet peas",                        // 5
      "Ground cover",                        // 6
      "",                                    // 7
      "- clover",                            // 8
    ];
    expect(listStart(lines, 5)).toBe(2);
    expect(listStart(lines, 3)).toBe(2);
    expect(listStart(lines, 6)).toBeNull();
    expect(listStart(lines, 8)).toBe(8);
    expect(listOwners(lines, 2)).toEqual({ lead: 1, heading: 0 });
    expect(listOwners(lines, 8)).toEqual({ lead: null, heading: 0 });
    const climbers = resolveStyle(listLayers(lines, 2), 80), clover = resolveStyle(listLayers(lines, 8), 80);
    expect(climbers.values).toMatchObject({ "list.gap": 2, "list.divider": "dots", "margin.x": 1 });
    expect(clover.values).toMatchObject({ "list.gap": 0, "list.divider": "dots" });
    // A box's list stops at its box; one after a box looks past it to the section's heading.
    const boxed = ["## Shed [style.list.gap::2]", "::box{pad=1}", "- rake", "::", "- hoe"];
    expect(listOwners(boxed, 2)).toEqual({ lead: null, heading: null });
    expect(listOwners(boxed, 4)).toEqual({ lead: null, heading: 0 });
  });
});
