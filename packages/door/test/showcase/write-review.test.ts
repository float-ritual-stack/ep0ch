// The write review section (PIE-1388): an agent's wall, the review its write was answered with, and Jev's suggestions
// page with its row: the problem as its title, the note named by its title (a link, never its id), the passage before
// and after, and what the writer did (PIE-1539). Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: write review (PIE-1388)", () => {
  const h = useShowcaseScreen(200);

  test("the page's first row names the wall by its title, the problem, the passage before and after, and followed", async () => {
    await h.app.act({ action: "section", args: { name: "write-review" }, as: "test-agent" });
    await until(() => marks["write-review"]!.every(m => h.screen().includes(m)), "the write review section", 15_000);
    // The table's rows are two lines (cozy): the problem wraps, "fix: line 3" on the row's first line, "stacks…" under it.
    const row = () => { const lines = h.screen().split("\n"), i = lines.findIndex(line => line.includes("fix: line 3") && line.includes("Shed")); return i < 0 ? null : lines[i]! + "\n" + lines[i + 1]!; };
    await until(() => (row() ?? "").includes("followed"), "the finding's row, settled", 15_000);
    const screen = h.screen();
    // The table's note cell is the note's title, never its id.
    expect(screen).not.toContain(h.seeded.notes.writeReview.id.slice(0, 13));
    expect(row()).toContain("line 3");
    expect(row()).toContain("stacks");
    // Before, the stacked line; after, the bullets the write that settled it split it into.
    expect(row()).toContain("The shed");
    expect(row()).toContain("Roof");
    // The 44-column tile (PIE-1402): each finding a card, every field shown, none hidden behind "+n columns".
    expect(screen).not.toContain("columns · widen to see");
    await until(() => h.screen().includes("after: "), "the narrow tile's card", 15_000);
    expect(h.screen()).toContain("passage: ");
  });
});
