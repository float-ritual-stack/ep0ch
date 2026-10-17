// PIE-982: the showcase's "Script examples" section. The worked examples of the scripts reference are pasted as notes
// (the page's own text, parsed by scriptExamples): Game 1 draws a tic-tac-toe board from its property and a run of
// ttt-play moves it; Seed order draws a table of its children with a computed column and draws again when one changes.
// One of the showcase's test files; the harness (harness.ts) seeds a scratch outline and opens the screen on it.
import { beforeAll, describe, expect, test } from "bun:test";
import { USER } from "../../src/socket";
import { extensionList } from "../../src/extensions";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: script examples", () => {
  const h = useShowcaseScreen();
  const { screen } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });

  test("the board and the table draw from the page's notes; a move and an edit change what they show", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "script-examples" }, as: "test-agent" });
    screen();
    await until(() => screen().includes("X to play") && screen().includes("Total"), "both examples drawn", 15_000);
    // The seed table: Beans 5 x 2, Peas 3 x 4, a total of 22.
    expect(screen()).toMatch(/Beans\s+│\s+5\s+│\s+2\s+│\s+10/);
    // A move through the script's own run (as ^K ttt-play cell=5 would), attributed to the script; the property is the state.
    const game = seeded.notes.exampleGame.id;
    const play = extensionList()!.extensions.find(e => e.name === "ttt-play")!;
    const ran = await app.dispatch.act({ action: `ext.${play.id}.run`, args: { block: game, cell: "5" } }, USER) as { written: string[] };
    await until(() => (screen().match(/O to play/) ?? []).length > 0, "the drawing follows the move", 15_000);
    const note = (await board.get(game))!;
    expect(note.text).toContain("[board::....X....]");
    expect((await board.get(ran.written[0]!))!.text).toContain("X played 5");
    // Example 4: the rule stamped the checklist under the note that matched, once.
    const match = (await board.children(seeded.notes.scriptExamples.id)).find(c => c.text.startsWith("Beans for the swap"))!;
    let stamped: Awaited<ReturnType<typeof board.children>> = [];
    for (const end = Date.now() + 15_000; Date.now() < end && !stamped.length;) { stamped = await board.children(match.id); await Bun.sleep(100); }
    expect(stamped.map(c => c.text)).toEqual(["Ship list for Beans for the swap\n- [ ] Pack\n- [ ] Label\n- [ ] Hand over"]);
    // The table's total follows an edit of a child.
    const order = seeded.notes.exampleOrder.id;
    const beans = (await board.children(order)).find(c => c.text.startsWith("Beans"))!;
    await board.update(beans.id, "Beans [qty::6] [price::2]", beans.revision!, USER);
    await until(() => /Total[\s│]+24/.test(screen()), "the total follows the edit", 15_000);
  }, 60_000);
});
