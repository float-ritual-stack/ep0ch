// The write review section (PIE-1388): an agent's wall, the review its write was answered with, and Jev's suggestions
// page with its row: the problem as its title, the note named by its title (a link, never its id), the passage before
// and after, and what the writer did (PIE-1539). Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, testSlack, until } from "../scratch";
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
  }, 3 * 15_000 * testSlack() + 10_000);   // its three waits, each scaled as until scales them, and room to act
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
    // "followe" can be drawn by the wall first; on a busy box the page's table lands a moment later.
    await until(() => lines().some(l => /┊\s+title\s+note\s+passage/.test(l)), "the page tile's table", 15_000);
    const head = lines().findIndex(l => /┊\s+title\s+note\s+passage/.test(l));
    expect(head).toBeGreaterThan(0);
    const left = lines()[head]!.indexOf("title"), noteAt = lines()[head]!.indexOf("note", left);
    const titles = lines().slice(head + 2, head + 14).map(l => l.slice(left, noteAt).trim()).join(" ").replace(/\s+/g, " ");
    expect(titles).toContain("fix: line 4 types a count a query keeps true (\"2 queued\" is stage=queued)");
    // A click selects the row. Away in the wall (a click in its text) and back by a click on the same row: that click only gives the page the keys, never opens (Codex on #1262). The next click, a while later, opens.
    const id = page().msg.id;
    const rowAt = () => { const ls = lines(), hy = ls.findIndex(l => /┊\s+title\s+note\s+passage/.test(l)), lx = hy < 0 ? -1 : ls[hy]!.indexOf("title");
      const ry = hy < 0 ? -1 : ls.findIndex((l, i) => i > hy && /fix: line/.test(l.slice(lx, lx + 20))); return ry < 0 ? null : { x: lx + 1, y: ry }; };
    const click = () => { const at = rowAt()!; h.press({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y } as never); h.press({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y } as never); };
    click();
    await Bun.sleep(700);
    expect(page().msg.id).toBe(id);
    expect(stage().nameOf(stage().focus)).toBe("page");
    const wy = lines().findIndex(l => l.includes("Tacks ran out")), wx = lines()[wy]!.indexOf("Tacks ran out");
    h.press({ kind: "mouse", action: "down", button: 0, x: wx, y: wy } as never); h.press({ kind: "mouse", action: "up", button: 0, x: wx, y: wy } as never);
    await until(() => stage().nameOf(stage().focus) === "wall", "the wall has the keys", 8000);
    await until(() => !!rowAt(), "the rows, the wall with the keys", 8000);
    click();
    await until(() => stage().nameOf(stage().focus) === "page", "the click gave the page the keys", 8000);
    await Bun.sleep(700);
    expect(page().msg.id).toBe(id);
    click();
    await until(() => page().msg.id !== id, "the finding's card opened", 8000);
    // Its crumbs read "…" until the outline answers for its ancestors (on a busy box, a moment after it opens).
    await until(() => h.screen().includes("Kitchen sink › Records"), "the card's crumbs", 8000);
  }, (2 * 15_000 + 5 * 8000) * testSlack() + 10_000);   // its seven waits, each scaled as until scales them, the two sleeps and room to act
});
