// The three focus levels (PIE-969), computed from each theme's own values: `container` (the tint under the figure the
// cursor is in), `item` (the row the cursor is on: a band and a left-edge marker) and `selection`. Every pair that has to
// read is checked and fails under its threshold: every text colour on each of the three at WCAG AA (4.5:1) in the themes
// with a ground of their own, the item marker 3:1 on the band and on the container's tint (1.4.11), the band and
// the selection dark (Evan is photosensitive: no bright fill) and told apart from each other, the container and the ground.
import { describe, expect, test } from "bun:test";
import { contrast, luminance, SURFACE_MAX_LUMINANCE, TEXT_INKS, THEME_NAMES, THEMES, type Rgb } from "../src/theme";

/** How far two colours are apart, channel by channel: a different colour, not a shade of the same. */
const apart = (a: Rgb, b: Rgb) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0);

describe("the focus levels are theme tokens", () => {
  for (const name of THEME_NAMES) {
    const t = THEMES[name], { container, item, selection } = t.focus, ground = t.ground ?? t.palette[0]!;
    test(`${name}: dark, apart from each other, the marker reads on both`, () => {
      if (t.ground) for (const c of [container, item.bg, selection]) expect(luminance(c)).toBeLessThanOrEqual(SURFACE_MAX_LUMINANCE);
      expect(item.glyph).toBe("▌");
      expect(contrast(item.bar, item.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(item.bar, container)).toBeGreaterThanOrEqual(3);
      for (const [a, b] of [[item.bg, container], [item.bg, selection], [container, selection], [item.bg, ground], [container, ground], [selection, ground]] as const)
        expect(apart(a, b)).toBeGreaterThan(30);
    });
    if (!t.ground) continue;   // classic keeps the exact VGA palette and is reported, never failed
    for (const [level, bg] of [["container", container], ["item", item.bg], ["selection", selection]] as const)
      test(`${name}: every text colour reads on the ${level} level (4.5:1)`, () => {
        for (const i of TEXT_INKS) expect(contrast(t.palette[i]!, bg), `ink ${i}`).toBeGreaterThanOrEqual(4.5);
      });
  }
});
