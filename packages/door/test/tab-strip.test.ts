// PIE-1288: every tab set's one strip. A one-row strip that doesn't fit keeps to its width, keeps the lit tab, and its
// "… N more" clicks the first tab it put away. Made-up labels.
import { expect, test } from "bun:test";
import { tabStrip } from "../src/surface/chip-rows";
import { width } from "../src/style";

test("a shared strip keeps to its width and the lit tab; … more presses the first tab put away", () => {
  const tabs = ["beans", "squash", "onions", "leeks", "kale", "chard", "garlic", "radish"].map((label, i) => ({ label, on: i === 7, hit: { action: "tab.select", args: { n: i } } }));
  const style = { on: "", off: "", pad: " " };
  for (const w of [20, 30, 41]) {
    const [row, ...rest] = tabStrip(tabs, { width: w, overflow: "share", style });
    expect(rest).toEqual([]);
    expect(width(row!.text)).toBeLessThanOrEqual(w);
    expect(row!.hits.some(h => h.args?.n === 7)).toBe(true);
    const more = row!.hits.at(-1)!;
    expect(row!.text).toContain("more");
    expect(more.args).toEqual({ n: row!.hits.length - 2 });
  }
});
