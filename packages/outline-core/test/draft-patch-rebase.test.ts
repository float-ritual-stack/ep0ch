import { describe, expect, test } from "bun:test";
import { applyLocated, rebaseSpans } from "../src/draft-patch-compare";

const rebase = (base: string, current: string, observed: string, replacement: string) => {
  const placed = rebaseSpans(base, current, [{ observed, replacement }]);
  return placed.ok ? applyLocated(current, placed.spans) : placed.reason;
};

describe("rebaseSpans (PIE-687)", () => {
  const base = "# Title\nBeans on Monday.\n\n## B\nJars in the cellar.\n\n## C\nNothing yet.";

  test("a span carries over an edit on other lines, above and below", () => {
    const current = base.replace("# Title", "# A longer title\nWith a subtitle").replace("Nothing yet.", "Nothing yet.\nMore at the end.");
    expect(rebase(base, current, "Jars in the cellar.", "Jars in the shed.")).toBe(current.replace("cellar", "shed"));
  });

  test("lines removed or added at either end keep the offsets right", () => {
    expect(rebase("a\nb\nc\nd\ne\nf", "A\nb\nd\ne\nf\ng", "e", "E")).toBe("A\nb\nd\nE\nf\ng");
    expect(rebase("a\nb\nc", "b\nc", "c", "C")).toBe("b\nC");
    expect(rebase("a\nb", "a\nb\nc\nd", "a", "A")).toBe("A\nb\nc\nd");
  });

  test("a rewritten line, even beside the span, is an overlap", () => {
    expect(rebase(base, base.replace("Monday", "Tuesday"), "Beans", "Peas")).toContain("someone changed that passage");
  });

  test("a span that is gone or now in the note twice is refused", () => {
    expect(rebase(base, base.replace("Jars in the cellar.", "Crates."), "Jars in the cellar.", "x")).toContain("someone changed");
    expect(rebase(base, `${base}\nJars in the cellar.`, "Jars in the cellar.", "x")).toContain("more than once");
  });

  test("two spans of one patch that overlap are refused", () => {
    const placed = rebaseSpans(base, base, [{ observed: "Beans on", replacement: "x" }, { observed: "on Monday", replacement: "y" }]);
    expect(placed.ok).toBe(false);
  });

  test("a span that never was in the base is refused", () => {
    expect(rebaseSpans(base, base, [{ observed: "absent", replacement: "x" }]).ok).toBe(false);
  });
});
