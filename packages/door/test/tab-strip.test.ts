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

test("a yielding tab is whole when the others can make room, and costs them nothing when they can't (PIE-1598)", () => {
  const tabs = (said: string) => [{ label: "beans", on: false }, { label: "a long squash row", short: "squash" }, { label: said, yield: true, on: true }, { label: "the onion bed", short: "onions" }, { label: "leeks", keep: true }];
  const strip = (said: string, w: number) => tabStrip(tabs(said), { width: w, overflow: "drop", style: { on: "", off: "", sep: " | " } })[0]!;
  // Their short forms are room enough: nothing goes into +N.
  const shortForms = strip("back to the door", 56);
  expect(shortForms.text).toContain("back to the door");
  expect(shortForms.text).toContain("squash");
  expect(shortForms.hits.some(h => h.index === -1)).toBe(false);
  // Narrower, they go into +N for it; `keep` stays.
  const dropped = strip("back to the door", 36);
  expect(dropped.text).toContain("back to the door");
  expect(dropped.text).toContain("leeks");
  expect(dropped.hits.some(h => h.index === -1)).toBe(true);
  // Too long for any of that: no tab goes, they take their short forms, and it takes what's left.
  const long = strip("the shed is locked until the frost has gone and the key is back on its hook", 56);
  expect(long.text).toContain("squash");
  expect(long.text).toContain("onions");
  expect(long.text).toContain("the shed");
  expect(long.hits.some(h => h.index === -1)).toBe(false);
  expect(width(long.text)).toBeLessThanOrEqual(56);
});
