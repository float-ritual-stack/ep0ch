// The write review section (PIE-1388): an agent's wall, the review its write was answered with, and Jev's suggestions
// page with its row: the note named by its title (a link, never its id), what was said and the passage. Scratch service,
// made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: write review (PIE-1388)", () => {
  const h = useShowcaseScreen(200);

  test("the page's first row names the wall by its title, with what its writer was told", async () => {
    await h.app.act({ action: "section", args: { name: "write-review" }, as: "test-agent" });
    await until(() => marks["write-review"]!.every(m => h.screen().includes(m)), "the write review section", 15_000);
    await until(() => h.screen().split("\n").some(line => line.includes("Shed status") && line.includes("dense")), "the finding's row", 15_000);
    const screen = h.screen();
    // The table's note cell is the note's title, never its id.
    expect(screen).not.toContain(h.seeded.notes.writeReview.id.slice(0, 13));
    expect(screen).toContain("line 3 stacks");
    // The 44-column tile (PIE-1402): each finding a card, every field shown, none hidden behind "+n columns".
    expect(screen).not.toContain("columns · widen to see");
    await until(() => h.screen().includes("said: line "), "the narrow tile's card", 15_000);
    expect(h.screen()).toContain("passage: ");
  });
});
