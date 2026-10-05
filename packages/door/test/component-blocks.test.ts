// One note through every door reader of component blocks: where a figure starts and ends is outline-core's
// componentBlocks, so a bare `::` in a figure's code example cuts nothing, and render, folds, links and export agree.
import { describe, expect, test } from "bun:test";
import { foldPoints, renderDoc, structureOf } from "../src/doc";
import { figuresAsAscii } from "../src/export";
import { linkBlockAt } from "../src/links";
import { presentLinks } from "../src/refs";
import { COMARK_NOTE, COMARK_NOTE_BLOCKS } from "../../outline-core/test/fixtures/component-notes";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "");
const ENV = { width: 70, cellW: 9, cellH: 18, graphics: false, maxImageRows: 4, unfold: false };
const body = COMARK_NOTE.slice(1).join("\n");

describe("a figure whose code example holds a bare ::, then a heading and a second figure", () => {
  test("structure: each figure's lines are its own, the heading between them is structure", () => {
    const block = structureOf(COMARK_NOTE);
    for (const b of COMARK_NOTE_BLOCKS) for (let i = b.start; i <= b.end; i++) expect(block[i]).toBe(b.start);
    expect(block[12]).toBe(-1);
    expect(block[COMARK_NOTE.length - 1]).toBe(-1);
  });

  test("folds: the one heading is the only fold point, and it runs to the note's end", () => {
    const points = foldPoints(COMARK_NOTE.join("\n"));
    expect(points.map(p => [p.kind, p.text, p.line])).toEqual([["heading", "Second", 12]]);
    expect(points[0]!.end).toBe(COMARK_NOTE.length);
  });

  test("render: both figures whole; the code example is the figure's text, never a closing ::", () => {
    const rows = renderDoc(body, ENV).lines.map(plain);
    const text = rows.join("\n");
    expect(text).toContain("::graph-stat");
    expect(text).toContain("the example figure");
    expect(rows.some(r => r.trim() === "::")).toBe(false);
    expect(rows.some(r => r.trim() === "## Second" || r.trim() === "Second")).toBe(true);
    expect(text).not.toMatch(/^\s*title: Open\s*$/m);
    expect(text).not.toMatch(/^\s*1\. the example figure\s*$/m);
  });

  test("links: the component's lines are left as typed", () => {
    expect(presentLinks(COMARK_NOTE.join("\n"), false, null).split("\n").slice(1, 19)).toEqual(COMARK_NOTE.slice(1, 19));
    expect(linkBlockAt(COMARK_NOTE, 1)).toBeNull();
  });

  test("export: both figures become fences, nothing of either left as written", () => {
    const out = figuresAsAscii(COMARK_NOTE.join("\n"), "n").split("\n");
    expect(out.filter(l => l === "```").length).toBe(4);
    expect(out).not.toContain("::");
    expect(out).toContain("## Second");
    expect(out.at(-1)).toBe("after");
  });
});
