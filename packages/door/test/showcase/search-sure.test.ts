// The search section (PIE-1197, PIE-1198): the Search evals page as a run keeps it, its live table of runs per model
// and the labelled set by source, with a run's report under it. Scratch service, made-up cases and numbers.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: search says how sure (PIE-1198)", () => {
  const h = useShowcaseScreen(200);

  test("the eval's page lists a run per model and the cases by where their label came from", async () => {
    await h.app.act({ action: "section", args: { name: "search-sure" }, as: "test-agent" });
    await until(() => marks["search-sure"]!.every(m => h.screen().includes(m)), "the search section", 15_000);
    await until(() => h.screen().includes("jev-1.14.0"), "a run per model", 15_000);
    const screen = h.screen();
    expect(screen).toContain("jev-1.13.0");
    expect(screen).toContain("agents read");
    expect(screen).toContain("the note made after");
  });
});
