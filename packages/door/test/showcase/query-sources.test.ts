// PIE-1508: an extension's completion source on a query line. The facets tile's where: line asks the service, and the
// Issues extension's issue words come beside the query words; picked, its row writes the whole line, the facets narrow
// to the note about that issue, and the source is told what became of its rows. Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { FacetsPane } from "../../src/desk/facets";
import { lineCompleter } from "../../src/surface/completer";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: your own words for a filter (PIE-1508)", () => {
  const h = useShowcaseScreen(180);

  test("Issues' words on the where: line write issue=\"#15\" and the facets narrow to its note", async () => {
    await h.app.act({ action: "section", args: { name: "query-sources" }, as: "test-agent" });
    h.press({ kind: "enter" });
    await until(() => marks["query-sources"]!.every(m => h.screen().includes(m)), "the query-sources section", 15_000);
    const stage = h.S().stages.get(h.S().sel).top;
    const pane: FacetsPane = stage.pane("facets");
    const act = (action: string, args = {}) => stage.dispatch.act({ action, args, tile: "facets" }, { kind: "user" });
    const told: unknown[][] = [];
    const real = h.board.completionPicked.bind(h.board);
    h.board.completionPicked = (...a: Parameters<typeof real>) => { told.push(a); return real(...a); };
    try {
      await act("facets.edit", { text: "seed sw" });
      await act("complete.ask");
      const shown = () => pane.draft ? lineCompleter(pane.draft)?.shown : null;
      await until(() => !!shown() && !shown()!.loading && shown()!.items.some(i => i.from === "ext.issues.issue-words"), "Issues' words on the line", 10_000);
      const n = shown()!.items.findIndex(i => i.from === "ext.issues.issue-words") + 1;
      expect(shown()!.items[n - 1]!.insertion).toBe('issue="#15"');
      expect(h.screen()).toContain('issue="#15"');
      await act("complete.accept", { n });
      // The row writes the line; it stays open to go on (AND …), and ⏎ applies it.
      expect(pane.draft?.text).toBe('issue="#15"');
      h.press({ kind: "enter" });
      await until(() => pane.query() === 'issue="#15"', "the issue's query applied");
      await until(() => pane.notes().length === 1 && pane.notes()[0]?.id === h.seeded.notes.seedTable.id, "the note about issue 15");
      expect(told.some(a => (a[2] as any)?.source === "ext.issues.issue-words" && (a[2] as any)?.outcome === "accepted")).toBe(true);
    } finally { h.board.completionPicked = real; }
  }, 40_000);
});
