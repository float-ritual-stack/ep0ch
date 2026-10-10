// A rule's decorations in the reader (PIE-600): where planDecorations puts them over a note's body, the band and
// track primitives, and renderDoc's decorate hook (in place of a heading, keeping its fold point; around a list).
import { expect, test } from "bun:test";
import { primitiveLines } from "../src/components";
import { BUILTIN_HEADING_STYLE_REGISTRY, headingStyleRegistry } from "@ep0ch/outline-core/heading-styles";
import { planDecorations } from "../src/decorations";
import { foldPoints, renderDoc } from "../src/doc";
import type { Decoration } from "../src/projection";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const deco = (over: Partial<Decoration>): Decoration => ({ rule: "note:x", name: "r", source: { kind: "note", blockId: "x" }, place: "above", status: "ready",
  hit: { at: "block", line: 0, end: 5, text: "T" }, view: { type: "badge", label: "hi" }, ...over });
const draw = { markdown: (t: string) => [t] };

test("band and track draw through the heading styles' drawer (PIE-599): a named style, the primitive's fields over it, a plain heading when narrow", () => {
  const wide = primitiveLines({ type: "band", text: "Beds", level: 1, pattern: "dots", align: "center" }, 80).map(plain);
  expect(wide).toHaveLength(3);
  // The built-in band style spaces its letters.
  expect(wide.join("\n")).toContain("B E D S");
  expect(wide.every(r => r.length === 80)).toBe(true);
  // A style the outline declares, by name: its lettering and rows.
  const plot = headingStyleRegistry([{ ...BUILTIN_HEADING_STYLE_REGISTRY.style("tab")!, name: "plot", rows: 1 }]);
  const named = primitiveLines({ type: "band", text: "Beds", style: "plot" }, 80, { headings: plot }).map(plain);
  expect(named).toHaveLength(1);
  expect(named[0]).toContain("BEDS");
  expect(primitiveLines({ type: "band", text: "Beds", level: 2 }, 30).map(plain)).toEqual(["## Beds"]);
  expect(primitiveLines({ type: "track" }, 80)).toHaveLength(1);
  expect(plain(primitiveLines({ type: "track" }, 20)[0]!)).toBe("─".repeat(20));
});

test("planDecorations: a block's above the body or below it; a construct's above, below, in its place or around it", () => {
  // Body lines 0..3 show note lines 1..4 (line 0 is the title).
  const lines = [1, 2, 3, 4];
  const plan = planDecorations([
    deco({}),
    deco({ place: "below" }),
    deco({ place: "replace", hit: { at: "construct", line: 2, end: 3, text: "Beds", kind: "heading", level: 1 } }),
    deco({ place: "around", hit: { at: "construct", line: 3, end: 5, text: "a", kind: "list" }, view: { type: "box", title: "List", children: [] } }),
    // The same place again: drawn above it instead.
    deco({ place: "replace", hit: { at: "construct", line: 2, end: 3, text: "Beds", kind: "heading", level: 1 } }),
    // Not drawn yet: a replace leaves the line as written, with a dim line above.
    deco({ place: "replace", status: "not-run", view: undefined, hit: { at: "text", line: 4, end: 5, text: "x!!!" } }),
  ], lines, draw);
  expect([...plan.after.keys()].sort()).toEqual([-1, 0, 2, 3].sort());
  expect([...plan.place].map(([at, p]) => [at, p.end])).toEqual([[1, 2], [2, 4]]);
  expect(plan.place.get(2)!.draw(20)).toEqual({ frame: { title: "List", colour: expect.any(Number) } });
  expect(plain(plan.after.get(2)![0]!(40)[0]!)).toContain("r · drawing…");
});

test("renderDoc's decorate hook: a band in a heading's place keeps its fold point, and folding it hides what's under it", () => {
  const body = "# Beds\n- one\n- two\n# Paths";
  const points = foldPoints(body);
  const band = (folded: Set<string>) => renderDoc(body, {
    width: 40, cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: false,
    folds: { points, folded },
    decorate: line => (line === 0 ? { end: 1, rows: ["=== BEDS ==="] } : null),
  });
  const open = band(new Set());
  expect(open.lines.map(plain)).toEqual(expect.arrayContaining(["=== BEDS ===", expect.stringContaining("one")]));
  expect(open.heads[0]).toMatchObject({ key: points[0]!.key, row: 0 });
  // A three-row band's fold is its middle row, where its words are.
  const tall = renderDoc(body, { width: 40, cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: false, folds: { points, folded: new Set() },
    decorate: line => (line === 0 ? { end: 1, rows: ["~~~", "BEDS", "~~~"] } : null) });
  expect(tall.heads[0]!.row).toBe(1);
  const folded = band(new Set([points[0]!.key])).lines.map(plain);
  expect(folded.slice(0, 2)).toEqual(["=== BEDS ===", "▸ 2 lines folded"]);
  expect(folded.join("\n")).not.toContain("one");
});

test("renderDoc's decorate hook: around draws the lines inside a titled frame", () => {
  const out = renderDoc("intro\n- one\n- two", {
    width: 30, cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: false,
    decorate: line => (line === 1 ? { end: 3, frame: { title: "Jobs", colour: 4 } } : null),
  }).lines.map(plain);
  expect(out[1]).toMatch(/^╭─ Jobs ─+╮$/);
  expect(out[2]).toContain("│ ");
  expect(out[2]).toContain("one");
  expect(out.at(-1)).toMatch(/^╰─+╯$/);
});

test("a whole block's around frames the body when nothing else takes a place; a frame never shows what a fold hides", () => {
  const box = deco({ place: "around", view: { type: "box", title: "Meeting", children: [] } });
  const plan = planDecorations([box], [1, 2, 3], draw);
  expect([...plan.place].map(([at, p]) => [at, p.end])).toEqual([[0, 3]]);
  const crowded = planDecorations([deco({ place: "replace", hit: { at: "construct", line: 2, end: 3, text: "B", kind: "heading", level: 1 } }), box], [1, 2, 3], draw);
  expect([...crowded.place.keys()]).toEqual([1]);
  expect(crowded.after.get(-1)).toHaveLength(1);
  const body = "- one\n  - inner\n- two", points = foldPoints(body);
  const out = renderDoc(body, {
    width: 30, cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: false,
    folds: { points, folded: new Set([points[0]!.key]) },
    decorate: line => (line === 0 ? { end: 3, frame: { title: "Jobs", colour: 4 } } : null),
  }).lines.map(plain).join("\n");
  expect(out).not.toContain("inner");
});

test("a hit inside a callout is drawn above the callout, never in its place", () => {
  const body = ["> [!note] Frost", "> close it!!!", "after"];
  const plan = planDecorations([deco({ place: "replace", hit: { at: "text", line: 2, end: 3, text: "> close it!!!" } })], [1, 2, 3], draw, body);
  expect(plan.place.size).toBe(0);
  expect([...plan.after.keys()]).toEqual([-1]);
});

test("a frame around the whole body keeps the folds inside it: a folded heading further down stays folded", () => {
  const body = "Intro\n# Beds\n- one\n- two\n# Paths", points = foldPoints(body);
  const beds = points.find(p => p.text === "Beds")!;
  const out = renderDoc(body, {
    width: 40, cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: false,
    folds: { points, folded: new Set([beds.key]) },
    decorate: line => (line === 0 ? { end: 5, frame: { title: "Meeting", colour: 4 } } : null),
  });
  const text = out.lines.map(plain).join("\n");
  expect(text).toContain("Beds");
  expect(text).not.toContain("one");
  expect(out.heads.map(h => h.key)).toContain(beds.key);
});

test("in a heading's place, the fold stays on the row with the band's words", () => {
  const body = "# Beds\n- one", points = foldPoints(body);
  const out = renderDoc(body, { width: 40, cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: false, folds: { points, folded: new Set() },
    decorate: line => (line === 0 ? { end: 1, rows: ["BEDS", "~~~", "~~~"], headRow: 0 } : null) });
  expect(out.heads[0]!.row).toBe(0);
});
