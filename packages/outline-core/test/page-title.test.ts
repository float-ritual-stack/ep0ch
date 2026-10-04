import { describe, expect, test } from "bun:test";
import { pageTitleLine, withPageTitle } from "../src/page-title";

// Fictional notes.
describe("a page names its own title", () => {
  test("a first line of only [page::x] gets x in front; the token stays", () => {
    expect(withPageTitle("[page::2026-09-30]")).toBe("2026-09-30 [page::2026-09-30]");
    expect(withPageTitle("[page::Seed Library]\nBroad beans, two packets.")).toBe("Seed Library [page::Seed Library]\nBroad beans, two packets.");
  });

  test("other tokens on the line stay, in order, and the page value is the title whatever its place", () => {
    expect(withPageTitle("[type::daily] [page::2026-09-30]")).toBe("2026-09-30 [type::daily] [page::2026-09-30]");
  });

  test("a title already there is never overwritten", () => {
    expect(withPageTitle("Plot notes [page::2026-09-30]")).toBe("Plot notes [page::2026-09-30]");
    expect(pageTitleLine("Plot notes [page::garden]")).toBeNull();
  });

  test("only the first line counts; a line without a page token, an escaped token or a blank line is left alone", () => {
    expect(withPageTitle("A title\n[page::garden]")).toBe("A title\n[page::garden]");
    expect(withPageTitle("[type::daily]")).toBe("[type::daily]");
    expect(withPageTitle("\\[page::garden]")).toBe("\\[page::garden]");
    expect(withPageTitle("")).toBe("");
    expect(withPageTitle("\n[page::garden]")).toBe("\n[page::garden]");
  });

  test("an indent and a CRLF line end are kept", () => {
    expect(pageTitleLine("  [page::garden]")).toBe("  garden [page::garden]");
    expect(withPageTitle("[page::garden]\r\nbody")).toBe("garden [page::garden]\r\nbody");
  });
});
