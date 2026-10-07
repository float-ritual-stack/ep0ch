// PIE-599: heading styles. `## Your calls [heading::band]` stays a Markdown heading; a style (the outline's, or a
// built-in) draws it inside a band of the figures' glyphs, and under the figures' narrow tier it is drawn as written.
// `--- [rule::fade]` draws a fading track. Pure renders and a NoteSurface; no service.
import { describe, expect, test } from "bun:test";
import { BUILTIN_HEADING_STYLES, headingStyleRegistry, headingStylesFromBlocks, type HeadingStyle } from "@ep0ch/outline-core/heading-styles";
import type { Msg } from "../src/board";
import { foldPoints, renderDoc, type DocEnv } from "../src/doc";
import { bandLetters, drawBand, drawTrack } from "../src/figures/banner";
import { DIM, INK } from "../src/figures/palette";
import { fg, visible } from "../src/style";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";

const char = (ch: string): Key => ({ kind: "char", ch });
const ENV: DocEnv = { width: 100, cellW: 9, cellH: 16, graphics: false, maxImageRows: 4, unfold: false };
const rows = (body: string, width: number, env: Partial<DocEnv> = {}) => renderDoc(body, { ...ENV, ...env, width }).lines.map(visible);
const builtin = (name: string) => BUILTIN_HEADING_STYLES.find(s => s.name === name)!;
const custom = (props: Record<string, string>): HeadingStyle[] =>
  headingStylesFromBlocks([{ id: "11111111-aaaa", properties: Object.entries(props).map(([key, value]) => ({ key, value })) }]).styles;

const BODY = [
  "What goes where this year.",          // 0
  "",                                     // 1
  "## Beds [heading::waffle]",            // 2
  "Four raised beds.",                    // 3
  "",                                     // 4
  "### Soil [heading::dots]",             // 5
  "Loam, mostly.",                        // 6
  "",                                     // 7
  "--- [rule::fade]",                     // 8
  "",                                     // 9
  "## Water",                             // 10
  "The hose runs along the fence.",       // 11
].join("\n");

describe("a styled heading is the heading it was", () => {
  test("its fold point is the heading's, named without its style, so restyling keeps the fold", () => {
    expect(foldPoints(BODY).map(p => [p.kind, p.level, p.text, p.line, p.end])).toEqual([
      ["heading", 2, "Beds", 2, 9],
      ["heading", 3, "Soil", 5, 9],
      ["heading", 2, "Water", 10, 12],
    ]);
    expect(foldPoints(BODY.replace("[heading::waffle]", "[heading::band]"))[0]!.key).toBe(foldPoints(BODY)[0]!.key);
  });

  test("wide, a band of three rows with the heading in it; narrow, the heading as written, without its style", () => {
    const wide = rows(BODY, 100);
    const at = wide.findIndex(l => l.includes("▾ Beds") || l.includes(" Beds "));
    expect(wide.slice(at - 1, at + 2).every(l => /[░▒▓]/.test(l))).toBe(true);
    expect(wide.join("\n")).not.toContain("[heading::");
    const narrow = rows(BODY, 40);
    expect(narrow).toContain("## Beds");
    expect(narrow).toContain("### Soil");
    expect(narrow).toContain("---");
    expect(narrow.join("\n")).not.toMatch(/\[heading::|\[rule::|[░▒▓]/);
  });

  test("a heading that names no style, and a level with no default, draws as before", () => {
    expect(rows("## Water\nhose", 100)).toEqual(["## Water", "hose"]);
    expect(rows("---\n\nend", 100)[0]).toBe("---");
  });

  test("a style the outline declares changes the look, and a level's default styles plain Markdown", () => {
    const reg = headingStyleRegistry(custom({ "heading-style": "plot", "heading-pattern": "rule", "heading-default": "2, rule", "heading-letters": "upper" }));
    const drawn = rows("## Water\nhose\n\n---\n\nend", 100, { headings: reg });
    expect(drawn.find(l => l.includes("WATER"))).toMatch(/─+  WATER  ─+/);
    expect(drawn.some(l => /^[─═]{100}$/.test(l))).toBe(true);
    // A heading that names a style keeps it over the level's default.
    expect(rows("## Beds [heading::dots]\nx", 100, { headings: reg }).join("\n")).toContain("·");
  });

  test("odd lines: a heading with only its style, a long styled rule when narrow, a rule right under a heading, a setext underline", () => {
    expect(rows("## [heading::band]\nx", 100)).toEqual(["##", "x"]);
    for (const l of rows(`${"-".repeat(80)} [rule::fade]`, 40)) expect(Bun.stringWidth(l)).toBeLessThanOrEqual(40);
    expect(rows("## Section\n--- [rule::fade]", 100)[1]).toMatch(/^▓.*▓$/);
    expect(rows("A paragraph\n--- [rule::fade]", 100).join("\n")).toContain("[rule::fade]");
    expect(rows("A paragraph\n*** [rule::fade]", 100)[1]).toMatch(/^▓.*▓$/);
  });

  test("an unknown style draws the heading as written, without the property", () => {
    expect(rows("## Beds [heading::nope]\nx", 100)).toEqual(["## Beds", "x"]);
  });
});

describe("the band", () => {
  test("every pattern and alignment, 1 to 3 rows, the heading on its row, nothing past the edge", () => {
    for (const pattern of ["stack", "waffle", "uptime", "dots", "rule"] as const)
      for (const [align, row, n] of [["left", "top", 3], ["center", "middle", 3], ["right", "bottom", 3], ["center", "middle", 1], ["left", "bottom", 2]] as const) {
        const style = { ...builtin("band"), pattern, align, row, rows: n, letters: "plain" as const };
        for (const W of [48, 80, 160]) {
          const band = drawBand(style, W, 2, "Beds", "Beds")!;
          expect(band.rows.length, `${pattern} ${align} ${n}`).toBe(n);
          for (const l of band.rows) expect(Bun.stringWidth(visible(l))).toBeLessThanOrEqual(W);
          expect(band.textRow).toBe(row === "top" ? 0 : row === "bottom" ? n - 1 : Math.floor((n - 1) / 2));
          const text = visible(band.rows[band.textRow]!), at = text.indexOf("Beds");
          if (align === "left") expect(at).toBe(2);
          if (align === "right") expect(W - at - 4).toBe(2);
          if (align === "center") expect(Math.abs(at + 2 - W / 2)).toBeLessThanOrEqual(2);
        }
      }
  });

  test("calm: dim (an uptime's down day, a dot, in the ink), never a full block; the heading carries the colour", () => {
    for (const s of BUILTIN_HEADING_STYLES) {
      for (const l of drawTrack(s, 100, s.name)!) {
        expect(visible(l)).not.toContain("█");
        for (const c of new Set(l.match(/\x1b\[[\d;]*m/g)!.filter(c => c !== "\x1b[0m"))) expect([fg(DIM), fg(INK)], s.name).toContain(c);
      }
    }
  });

  test("a rule's track fades in from both edges; narrow, the rule as written", () => {
    const track = visible(drawTrack(builtin("fade"), 100)![0]!);
    expect(track.startsWith("▓")).toBe(true);
    expect(track.endsWith("▓")).toBe(true);
    expect(track.slice(45, 55)).not.toMatch(/[▓▒]/);
    expect(drawTrack(builtin("fade"), 40)).toBeNull();
  });

  test("padding and margin: clear rows around the heading, blank rows and columns around the band", () => {
    const band = drawBand({ ...builtin("band"), letters: "plain", padding: { rows: 1, cols: 4 }, margin: { rows: 1, cols: 2 } }, 80, 2, "Beds", "Beds")!;
    expect(band.rows.length).toBe(5);
    expect([band.rows[0], band.rows[4]]).toEqual(["", ""]);
    const r = band.rows.map(visible), at = r[2]!.indexOf("Beds");
    expect(r[1]!.startsWith("  ")).toBe(true);
    expect(r[1]!.slice(at - 4, at + 8).trim()).toBe("");
    expect(r[3]!.slice(at - 4, at + 8).trim()).toBe("");
  });

  test("lettering: as written, capitals, spaced capitals; a heading too long for the band is drawn as written", () => {
    expect(bandLetters("Your calls", "spaced")).toBe("Y O U R   C A L L S");
    expect(bandLetters("Your calls", "upper")).toBe("YOUR CALLS");
    expect(drawBand(builtin("band"), 60, 2, "A".repeat(60), "x")).toBeNull();
  });
});

describe("declared styles", () => {
  test("each field read, a bad one said and its default kept; the first note to claim a name has it", () => {
    const r = headingStylesFromBlocks([
      { id: "aaaaaaaa-1", properties: [{ key: "heading-style", value: "Plot" }, { key: "heading-pattern", value: "zigzag" }, { key: "heading-rows", value: "2" }, { key: "heading-padding", value: "1 4" }, { key: "heading-tone", value: "green" }, { key: "heading-default", value: "1, rule, 9" }] },
      { id: "bbbbbbbb-2", properties: [{ key: "heading-style", value: "plot" }] },
    ]);
    expect(r.styles).toHaveLength(1);
    expect(r.styles[0]).toMatchObject({ name: "plot", pattern: "stack", rows: 2, padding: { rows: 1, cols: 4 }, tone: "green", defaults: [1, "rule"] });
    expect(r.problems.join("\n")).toContain('heading-pattern "zigzag" is one of stack, waffle, uptime, dots, rule');
    expect(r.problems.join("\n")).toContain('heading-default "9"');
    expect(r.problems.join("\n")).toContain("plot is declared already");
  });
});

describe("in a reader", () => {
  const host = (): SurfaceHost => ({ ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
  const note = (text: string): Msg => ({ id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, props: {} });

  test(") stops on a styled heading and f folds its section; the band says what it hides", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(`Plan the allotment\n${BODY}`), h);
    const body = () => s.render(100, 60, h).lines.map(visible).join("\n");
    expect(body()).toContain("Four raised beds.");
    s.key(char(")"), h);
    expect(s.describe().folds).toMatchObject({ selected: "## Beds" });
    s.key(char("f"), h);
    const folded = body();
    expect(folded).not.toContain("Four raised beds.");
    expect(folded).toMatch(/▸ Beds · \d+ lines? folded/);
    expect(folded).toMatch(/[░▒▓].*▸ Beds/);
    s.key(char(")"), h);
    expect(s.describe().folds).toMatchObject({ selected: "## Water" });
  });
});
