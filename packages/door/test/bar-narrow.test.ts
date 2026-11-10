// PIE-1405: the power bar at Evan's 44 and 40 columns. The lit row's name stays readable while its cut-short detail
// scrolls (the lit row reads in full by itself, PIE-1140), and what's typed gets the line before the count does.
import { describe, expect, test } from "bun:test";
import { PowerBar } from "../src/bar/bar";
import { Overflow } from "../src/overflow";
import { visible } from "../src/style";

const row = { key: "page:glyphs", label: "Glyphs", detail: "draws a glyph beside every note that names a moon phase, a planet or a tarot card", chip: "rule", oneLine: true };
const rowText = (on: boolean, w: number, r: object = row, previewUp = false) => (PowerBar.prototype as any).rowText.call({ previewUp }, { source: { id: "extensions" }, row: r }, on, w) as string[];

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
});
