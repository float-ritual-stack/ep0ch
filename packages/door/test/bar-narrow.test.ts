// PIE-1405: the power bar at Evan's 44 and 40 columns. The lit row's name stays readable while its cut-short detail
// scrolls (the lit row reads in full by itself, PIE-1140), and what's typed gets the line before the count does.
import { describe, expect, test } from "bun:test";
import { PowerBar } from "../src/bar/bar";
import { ListPicker } from "../src/surface/picker";
import { Overflow } from "../src/overflow";
import { visible } from "../src/style";

const row = { key: "page:glyphs", label: "Glyphs", detail: "draws a glyph beside every note that names a moon phase, a planet or a tarot card", chip: "rule", oneLine: true };
const rowText = (on: boolean, w: number, r: object = row, previewUp = false, rows = 5) => (PowerBar.prototype as any).rowText.call({ previewUp }, { source: { id: "extensions" }, row: r }, on, w, rows) as string[];

describe("the power bar at 44 and 40 columns", () => {
  for (const w of [42, 38]) test(`a lit row's name stays put while its detail scrolls (${w} cells)`, () => {
    const lines = rowText(true, w);
    expect(lines).toHaveLength(1);
    const o = new Overflow();
    o.keys();
    const at = (now: number) => visible(o.draw(lines, w, now).lines[0]!);
    expect(at(0)).toStartWith(" Glyphs · draws");
    // Seconds on, the detail has scrolled in its own cells; the name hasn't moved.
    for (const now of [1500, 3000, 6000]) expect(at(now)).toStartWith(" Glyphs · ");
    expect(at(3000)).not.toBe(at(0));
  });

  // PIE-1705: an install row with its preview up (under the list at 44, beside it at full width) reads from its first
  // word and is cut at its end, however long it stays lit; the preview reads the rest. The scroll above rested on the
  // description's last words ("ames an ep0ch-artifacts repo deploys it.").
  const install = { key: "install:moth-kit", label: "install Moth kit", detail: "Saving a note that names a moth garden plants it, and a later save waters it.", oneLine: true };
  for (const w of [42, 80]) test(`a lit install row with its preview up is cut at its end (${w} cells)`, () => {
    const lines = rowText(true, w, install, true);
    expect(lines).toHaveLength(1);
    const o = new Overflow();
    o.keys();
    for (const now of [0, 1500, 3000, 6000, 12_000]) {
      const shown = visible(o.draw(lines, w, now).lines[0]!).trimEnd();
      expect(shown).toStartWith(" install Moth kit · Saving a note that");
      expect(shown).toEndWith("…");
    }
  });

  // PIE-1729: a recording's row wraps at 44 (its name, then what it does). Lit, the marquee scrolled its second line
  // from that line's start: "ecorded: comment on Planting checklist". Lit, it wraps whole and stays still.
  const recording = { key: "script:comment-on-compost-bays-3", label: "comment-on-compost-bays-3", detail: "Recorded: comment on Compost bays, with your words, wherever Compost bays is open · ⏎ for a form" };
  for (const w of [42, 38]) test(`a lit row that wraps keeps every letter, its whole words in its lines (${w} cells)`, () => {
    const lines = rowText(true, w, recording);
    const o = new Overflow();
    o.keys();
    const words = (now: number) => o.draw(lines, w, now).lines.map(l => visible(l).trim()).join(" ").replace(/\s+/g, " ");
    for (const now of [0, 1500, 3000, 6000]) {
      expect(words(now)).toContain("comment-on-compost-bays-3 · Recorded: comment on Compost bays,");
      expect(words(now)).toContain("⏎ for a form");
      expect(words(now)).not.toContain("…");
    }
    // Unlit, it keeps the list's two lines, cut at its end.
    const unlit = rowText(false, w, recording);
    expect(unlit).toHaveLength(2);
    expect(unlit.map(l => visible(l).trim()).join(" ")).toContain("Recorded: comment on Compost bays");
    expect(visible(unlit[1]!).trimEnd()).toEndWith("…");
  });

  // In a short bar (44×13: a list of three rows) the lit row gets two lines and is still cut: its last line stays put,
  // cut at its end, never scrolled from its start.
  const long = { key: "action:tile.open", label: "tile.open", detail: "open a new tile beside the one you're in, or as a tab in it: a screen, a tree, a reader, a preview, a terminal, a query, a board, a river" };
  for (const w of [42, 38]) test(`a lit row longer than the list's rows keeps its lines' first letters (${w} cells)`, () => {
    const lines = rowText(true, w, long, false, 3);
    expect(lines).toHaveLength(2);
    const o = new Overflow();
    o.keys();
    const at = (now: number) => o.draw(lines, w, now).lines.map(l => visible(l).trimEnd());
    const first = at(0);
    expect(first[1]).toEndWith("…");
    for (const now of [1500, 3000, 6000]) expect(at(now)).toEqual(first);
  });

  // CodeRabbit on #1429: the lit row was sized from the height the list was placed in last time. A bar that gets
  // shorter (the pane resized to 44×13, a preview put under the list) drew the lit row for the old height, its last
  // lines clipped with no mark. Sized from the height being drawn, it's cut at its end, marked.
  test("a lit row sized for a list that got shorter is cut at its end, in the height drawn now", () => {
    const items = [{ source: { id: "actions" }, row: long }];
    const self = { previewUp: false };
    const picker = new ListPicker({ name: "bar", items: () => items, row: (it, _i, on, w, rows) => (PowerBar.prototype as any).rowText.call(self, it, on, w, rows), choose() {} });
    picker.lines(42, 12);
    const shown = picker.lines(42, 3).map(l => visible(l).trimEnd());
    expect(shown.length).toBeLessThanOrEqual(3);
    expect(shown[0]).toStartWith(" tile.open · open a new tile");
    expect(shown.at(-1)).toEndWith("…");
  });
});
