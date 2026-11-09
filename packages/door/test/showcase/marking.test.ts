// PIE-1237's demo, and its end-to-end test: the marks section marks by key (alt+m), by click (the tile menu's "mark
// this note", a ◆ label clicked off) and by act (an agent's block.mark), and the guide's `marked:today` view and the
// facets tile list what was marked today, an agent's look-here (a mark with a reason) left out. Seeded scratch outline.
import { describe, expect, test } from "bun:test";
import { FacetsPane } from "../../src/desk/facets";
import { USER } from "../../src/socket";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: marks", () => {
  const h = useShowcaseScreen(180);

  test("alt+m marks, a click on the menu marks, an agent's act marks; marked:today lists them; a click on ◆ takes one off", async () => {
    await h.app.act({ action: "section", args: { name: "marks" }, as: "test-agent" });
    h.press({ kind: "enter" });
    const stage = h.S().stages.get(h.S().sel).top;
    const today: FacetsPane = stage.pane("today");
    const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => stage.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, USER);
    const { markPotatoes: potatoes, markFrost: frost, marking: guide } = h.seeded.notes;
    const listed = () => today.notes().map(n => n.id).sort();
    await until(() => h.screen().includes("Seed potatoes chitting") && h.screen().includes("where: marked:today"), "the marks section");
    expect(listed()).toEqual([]);

    // Key: alt+m on the bed reader marks its note, framed in the tile and listed by marked:today.
    await act("tile.focus", {}, "bed");
    h.press({ kind: "alt", ch: "m" });
    await until(() => h.app.marks.list().some(m => m.block === potatoes.id), "the person's mark in the service");
    await until(() => h.screen().includes("◆ marked · by you"), "the frame on the bed reader");
    await until(() => listed().includes(potatoes.id), "marked:today in the facets tile");
    const [mine] = h.app.marks.list();
    expect(mine).toMatchObject({ block: potatoes.id, author: "user", by: "user", surface: "door" });
    // The guide's own ::view{query="marked:today"} is the service's watched answer: it lists the note too.
    // (a row of the view's table, ┊-framed in the guide's reader)
    await until(() => /┊\s+Seed potatoes chitting/.test(h.screen()), "the guide's view");

    // Key again: the person's mark comes off.
    h.press({ kind: "alt", ch: "m" });
    await until(() => !h.app.marks.list().length, "unmarked");
    await until(() => !listed().includes(potatoes.id), "out of marked:today");
    await until(() => !/┊\s+Seed potatoes chitting/.test(h.screen()), "out of the guide's view");

    // Click: the tile menu's "mark this note" is block.mark-toggle; its row is there, and pressing it marks.
    const menu = await act("tile.menu", {}, "bed") as { rows: { label: string; action: string }[] };
    const row = menu.rows.find(r => r.label === "mark this note");
    expect(row?.action).toBe("block.mark-toggle");
    h.press({ kind: "esc" });
    await act(row!.action, {}, "bed");
    await until(() => listed().includes(potatoes.id), "the click's mark in marked:today");

    // Act: an agent marks the frost note (a pocket mark, attributed), and asks the person to look at the guide (a reason).
    await h.app.act({ action: "block.mark", args: { id: frost.id }, as: "loki" });
    await h.app.act({ action: "block.mark", args: { id: guide.id, reason: "needs your call" }, as: "loki" });
    await until(() => listed().includes(frost.id), "the agent's mark in marked:today");
    await until(() => h.screen().includes("◆ needs your call · by loki"), "the look-here frame on the guide");
    // The look-here stays out of the pocket.
    expect(listed()).toEqual([potatoes.id, frost.id].sort());
    const byLoki = await h.board.request("blocks.query", { query: { where: "marked-by:loki" } });
    expect(byLoki.blocks.map(b => b.id)).toEqual([frost.id]);

    // A click on the ◆ label takes that mark off.
    const rows = h.screen().split("\n"), y = rows.findIndex(l => l.includes("◆ needs your call")), x = rows[y]!.indexOf("◆ needs your call") + 2;
    h.press({ kind: "mouse", action: "down", button: 0, x, y }); h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => !h.app.marks.list().some(m => m.reason), "the look-here taken off");
    expect((await act("marks.list") as { marks: { block?: string }[] }).marks.map(m => m.block).sort()).toEqual([potatoes.id, frost.id].sort());
  }, 40_000);
});
