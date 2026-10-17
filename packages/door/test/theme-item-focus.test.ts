// Item focus (PIE-969): the row the cursor is on inside the tile, figure or table that has the keys. Computed from the
// theme's own values: every text colour the door draws reads on the item band at WCAG AA (4.5:1) in the themes with a
// ground of their own, the band is dark (Evan is photosensitive: no bright fill), the edge bar shows on it, and it is
// told apart from the container's tint (`tint.ruler`) it sits on.
import { describe, expect, test } from "bun:test";
import { contrast, luminance, SURFACE_MAX_LUMINANCE, TEXT_INKS, THEME_NAMES, THEMES } from "../src/theme";
import { itemBg, selected } from "../src/style";
import { setTheme } from "../src/theme";

describe("item focus is a theme token", () => {
  for (const name of THEME_NAMES) {
    const t = THEMES[name];
    test(`${name}: a clear, dark band under every text colour`, () => {
      expect(luminance(t.item.bg)).toBeLessThanOrEqual(SURFACE_MAX_LUMINANCE);
      expect(contrast(t.item.bar, t.item.bg)).toBeGreaterThanOrEqual(3);
      // Told apart from the container's tint and from the ground: a different colour, not a shade of the same.
      const apart = (a: readonly number[], b: readonly number[]) => a.reduce((n, v, i) => n + Math.abs(v - b[i]!), 0);
      expect(apart(t.item.bg, t.tint.ruler)).toBeGreaterThan(30);
      expect(apart(t.item.bg, t.ground ?? t.palette[0]!)).toBeGreaterThan(30);
      if (!t.ground) return;   // classic keeps the exact VGA palette and is reported, never failed
      for (const i of TEXT_INKS) expect(contrast(t.palette[i]!, t.item.bg)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("every list's selected row is that band", () => {
    for (const name of THEME_NAMES) {
      setTheme(name);
      expect(selected(true)).toContain(itemBg());
      expect(itemBg()).toBe(`\x1b[48;2;${THEMES[name].item.bg.join(";")}m`);
    }
    setTheme("calm");
  });
});
