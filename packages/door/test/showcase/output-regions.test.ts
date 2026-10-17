// PIE-956: the showcase's "Regions in prose" section. A render script's table, a ::= sentence and a written output region read
// like the page around them, each behind one dim mark in the margin that shows its name, when it ran and its controls
// while the cursor is on it. One of the showcase's test files; the harness (harness.ts) seeds a scratch outline and opens the screen.
import { beforeAll, describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: regions in prose", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("three generated regions read like the prose around them: no box, no header, no buttons; one mark each", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "output-regions" }, as: "test-agent" });
    screen();
    const id = seeded.notes.outputRegions.id;
    const first = (await board.get(id))!;
    await until(() => screen().includes("Sam sows beans") && /Owner\s.*Week/.test(screen()) && screen().includes("Sam waters the beans"), "the three regions drawn", 15_000);
    const rows = screen().split("\n").map(r => r.slice(r.indexOf("│") + 1));
    expect(rows.filter(r => /^≡/.test(r.trimEnd().replace(/^│?/, "")) || r.includes("≡ ")).length).toBeGreaterThanOrEqual(3);
    expect(screen()).not.toMatch(/ran (just now|\d+ min ago)|\[keep\]|run again|\[!output\]|╭─ ▾ .*output/);
    // Drawing wrote nothing.
    const after = (await board.get(id))!;
    expect([after.text, after.revision]).toEqual([first.text, first.revision]);
    expect(await board.children(id)).toHaveLength(0);
  }, 40_000);
});
