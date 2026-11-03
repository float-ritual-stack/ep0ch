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
    // The table's rows wrap: the problem whole in the title column (PIE-1541), "fix: line 3" on the row's first line,
    // "stacks…" under it, the other columns narrower beside it.
    const row = () => { const lines = h.screen().split("\n"), i = lines.findIndex(line => line.includes("fix: line 3") && line.includes("Shed")); return i < 0 ? null : lines[i]! + "\n" + lines[i + 1]!; };
    await until(() => (row() ?? "").includes("followe"), "the finding's row, settled", 15_000);
    const screen = h.screen();
    // The table's note cell is the note's title, never its id.
    expect(screen).not.toContain(h.seeded.notes.writeReview.id.slice(0, 13));
    expect(row()).toContain("line 3");
    expect(row()).toContain("stacks");
    // Before, the stacked line; after, the bullets the write that settled it split it into.
    expect(row()).toContain("The");
    expect(row()).toContain("shed");
    expect(row()).toContain("Roo");
    // The 44-column tile (PIE-1402): each finding a card, every field shown, none hidden behind "+n columns".
    expect(screen).not.toContain("columns · widen to see");
    await until(() => h.screen().includes("after: "), "the narrow tile's card", 15_000);
    expect(h.screen()).toContain("passage: ");
  });
});

describe.skipIf(!outliner)("showcase: write review at 177 columns (PIE-1541)", () => {
  const h = useShowcaseScreen(177);

  // PIE-1541: in the page's tile (66 columns at 177) each row's problem reads whole, wrapped, the other columns giving
  // way; a click on a row selects it, and a second click on it, however long after, opens the finding's card.
  test("at 66 columns the problem reads whole; a click selects the row and a second click opens its card", async () => {
    await h.app.act({ action: "section", args: { name: "write-review" }, as: "test-agent" });
    await until(() => h.screen().includes("followe"), "the finding's row, settled", 15_000);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const page = () => stage().pane("page").surface;
    const lines = () => h.screen().split("\n");
    // The page tile's rows: the problem's words in the title column, every one of them, before the note's title.
    const head = lines().findIndex(l => /┊\s+title\s+note\s+passage/.test(l));
    expect(head).toBeGreaterThan(0);
    const left = lines()[head]!.indexOf("title"), noteAt = lines()[head]!.indexOf("note", left);
    const titles = lines().slice(head + 2, head + 14).map(l => l.slice(left, noteAt).trim()).join(" ").replace(/\s+/g, " ");
    expect(titles).toContain("fix: line 4 types a count a query keeps true (\"2 queued\" is stage=queued)");
    // A click, then another on the same row a while later: the first selects, the second opens the finding.
    const y = lines().findIndex((l, i) => i > head && l.slice(left, noteAt).includes("fix:")), x = left + 1;
    const click = () => { h.press({ kind: "mouse", action: "down", button: 0, x, y } as never); h.press({ kind: "mouse", action: "up", button: 0, x, y } as never); };
    const id = page().msg.id;
    click();
    await Bun.sleep(700);
    expect(page().msg.id).toBe(id);
    click();
    await until(() => page().msg.id !== id, "the finding's card opened", 8000);
    expect(page().msg.properties?.some?.((p: { key: string }) => p.key === "rubric") ?? h.screen().includes("rubric")).toBe(true);
    await h.app.act({ action: "back", tile: "page", as: "test-agent" }).catch(() => undefined);
  });
});
