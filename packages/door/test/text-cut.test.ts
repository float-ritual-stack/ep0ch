// PIE-1291: text width and cutting have one rule. Wide glyphs (CJK, emoji), joined emoji and a soft hyphen go through
// a callout, a fence, a frame and the editor at a narrow width, and no row is wider than the room it was given.
import { describe, expect, test } from "bun:test";
import { renderDoc } from "../src/doc";
import { Draft } from "../src/edit";
import { primitiveLines } from "../src/components";
import { renderGraph } from "../src/graphs";
import { visible, width } from "../src/style";
import { lookFor } from "../src/look";

const W = 30;
const env = { width: W, cellW: 9, cellH: 18, graphics: false, maxImageRows: 4, unfold: true };
const draw = (body: string) => renderDoc(body, env).lines;
const widest = (lines: readonly string[]) => Math.max(0, ...lines.map(width));
const CJK = "漢字の題名はとても長くて枠に収まらない見出し";
const CODER = "👩‍💻";

describe("nothing drawn overflows its width", () => {
  test("a callout with a wide title keeps its corner", () => {
    const lines = draw(`> [!note] ${CJK}\n> 本文 ${CODER} soft\u00ADhyphen`);
    expect(widest(lines)).toBeLessThanOrEqual(W);
    expect(visible(lines[0]!).trimEnd().endsWith("╮")).toBe(true);
    // The words the top edge had no room for flow into the box, none lost.
    expect(lines.map(l => visible(l)).join("").replace(/[\s│╭╮╰╯─…]/g, "")).toContain("見出し");
  });

  test("a fence of wide glyphs is cut into rows that fit", () => {
    const lines = draw("```\n" + CJK + CJK + "\n" + CODER.repeat(20) + "\n```");
    expect(widest(lines)).toBeLessThanOrEqual(W);
  });

  test("a framed decoration, a box and an extension's box with a wide title fit", () => {
    expect(widest(draw(`::box{border=heavy}\n${CJK}\n::`))).toBeLessThanOrEqual(W);
    const box = primitiveLines({ type: "box", title: CJK, children: [{ type: "text", text: `${CODER} soft\u00ADhyphen ${CJK}` }] }, 24);
    expect(box.map(width)).toEqual(box.map(() => 24));
  });

  test("a callout's frame is the look's border, as a box's is", () => {
    const look = { values: { ...lookFor(null, {}, 80).values, border: "heavy" } as never, layers: [], width: 80 };
    const lines = renderDoc(`> [!note] ${CJK}\n> body`, { ...env, look }).lines.map(l => visible(l));
    expect(lines[0]!.startsWith("┏━")).toBe(true);
    expect(lines.at(-1)!.startsWith("┗")).toBe(true);
    expect(visible(draw("> [!note] Plain\n> body")[0]!).startsWith("╭─")).toBe(true);
  });

  test("an artifact card with a wide title fits", () => {
    expect(widest(draw(`[artifact::/tmp/${CJK}${CJK}.html]`))).toBeLessThanOrEqual(W);
  });
});

describe("the editor measures by glyph", () => {
  test("five joined emoji in ten cells are one row", () => {
    const d = new Draft("b1", 1, CODER.repeat(5));
    d.key({ kind: "home" } as never);
    const rows = d.render(10, 4).filter(r => visible(r).trim());
    expect(rows).toHaveLength(1);
    expect(widest(rows)).toBeLessThanOrEqual(10);
  });

  test("wide glyphs and a soft hyphen wrap where the screen ends", () => {
    const d = new Draft("b1", 1, `${CJK} soft\u00ADhyphen ${CODER}${CODER}`);
    expect(widest(d.render(12, 10))).toBeLessThanOrEqual(12);
  });

  test("the cursor after a wide glyph is in the cell after it", () => {
    const d = new Draft("b1", 1, "漢字x");
    d.render(20, 2);
    d.key({ kind: "end" } as never);
    d.render(20, 2);
    expect(d.cursorCol).toBe(5);
  });
});

test("one sparkline: a component's and a figure's draw the same values the same", () => {
  const values = [10, 11, 10, 12, 11];
  const component = visible(primitiveLines({ type: "sparkline", values }, 40).join("")).trim().split(/\s+/).at(-1);
  const figure = renderGraph("spark", `data: [${values.join(", ")}]`, 40).map(l => visible(l).replace(/[^_░▒▓█]/g, "")).find(Boolean);
  expect(component).toBe(figure);
});
