// PIE-1288: every tab set's one strip. A one-row strip that doesn't fit keeps to its width, keeps the lit tab, and its
// +N opens all choices through their existing actions. Made-up labels.
import { expect, test } from "bun:test";
import { tabStrip } from "../src/surface/chip-rows";
import { C, width } from "../src/style";
import { setTheme, theme, THEMES } from "../src/theme";

test("a shared strip keeps the current tab and every click inside its width", () => {
  const tabs = ["beans", "squash", "onions", "leeks", "kale", "chard", "garlic", "radish"].map((label, i) => ({ label, on: i === 7, hit: { action: "tab.select", args: { n: i } } }));
  const style = { on: "", off: "", pad: " " };
  for (const w of [20, 30, 41]) {
    const [row, ...rest] = tabStrip(tabs, { width: w, overflow: "share", style });
    expect(rest).toEqual([]);
    expect(width(row!.text)).toBeLessThanOrEqual(w);
    expect(row!.hits.some(h => h.args?.n === 7)).toBe(true);
    const more = row!.hits.find(h => h.action === "strip.more");
    if (more) expect(row!.text).toMatch(/\+\d/);
    expect(row!.hits.every(h => h.from >= 0 && h.to <= w)).toBe(true);
  }
});

test("a strip's default look is the theme it's drawn in, not the one it was imported under", () => {
  const was = theme().name;
  try {
    for (const name of ["calm", "night"] as const) {
      setTheme(name);
      const [row] = tabStrip([{ label: "beans", on: true }, { label: "squash" }], { width: 40 });
      expect(row!.text).toContain(`\x1b[38;2;${THEMES[name].palette[C.grey]!.join(";")}m`);
    }
  } finally { setTheme(was); }
});
