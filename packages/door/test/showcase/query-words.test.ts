import { afterAll, describe, expect, test } from "bun:test";
import { FacetsPane } from "../../src/desk/facets";
import { lineCompleter } from "../../src/surface/completer";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: words become a query", () => {
  const jev = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const { questions } = await request.json();
    return Response.json({ model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(questions).map(([id, question]) => {
      const q = question as { type: string; criteria: Record<string, string> };
      const selected = Object.entries(q.criteria ?? {}).find(([, value]) => value === "trellises")?.[0] ?? "none";
      return [id, q.type === "noul" ? { noul: id === "gate:tag" ? 0.96 : 0.02 }
        : { choice: id === "pick:tag" || id === "words:tag" ? selected : "none", confidence: 0.9, probabilities: { [selected]: 0.98, none: 0.02 } }];
    })) });
  } });
  const h = useShowcaseScreen(180);
  h.scratch.hostEnv = { TYPESAFE_API_KEY: "recorded-answer", OUTLINER_JEV_ENDPOINT: `http://127.0.0.1:${jev.port}` };
  afterAll(() => jev.stop(true));

  test("a ghost waits for Tab, lights the picks, teaches an alias, and Esc leaves the next sentence", async () => {
    await h.app.act({ action: "section", args: { name: "query-words" }, as: "test-agent" });
    h.press({ kind: "enter" });
    const stage = h.S().stages.get(h.S().sel).top;
    const pane: FacetsPane = stage.pane("facets");
    const act = (action: string, args = {}) => stage.dispatch.act({ action, args, tile: "facets" }, { kind: "user" });
    await until(() => h.screen().includes("where:"), "the query words showcase");
    await act("facets.edit", { text: "trellises copper" });
    await act("complete.ask");
    await until(() => !!pane.draft && !!lineCompleter(pane.draft)?.shown?.items[0]?.querySuggestion, "the query ghost", 10_000);
    expect(pane.query()).toBe("stage=ready");
    const ghost = h.screen();
    expect(ghost).toContain("text~");
    expect(ghost).toContain("#trellises");
    expect(pane.describe().facets.some(f => f.key === "tag" && f.values.some(v => v.value === "trellises" && v.state === "include"))).toBe(true);
    h.press({ kind: "tab" });
    await until(() => pane.notes().length === 1 && pane.notes()[0]?.id === h.seeded.notes.queryTrellis.id, "the accepted filter's one note");
    expect(pane.query()).toContain("stage=ready");
    const learned = await h.board.query("rule-name=query-words");
    expect(learned[0]?.text).toContain("[alias::trellises=");
    await act("facets.edit", { text: "trellises" });
    await act("complete.ask");
    await until(() => !!pane.draft && !!lineCompleter(pane.draft)?.shown?.items[0]?.querySuggestion, "the learned alias");
    const before = pane.query();
    await act("complete.dismiss");
    expect(pane.draft?.text).toBe("trellises");
    expect(pane.query()).toBe(before);
    expect(lineCompleter(pane.draft!)?.shown).toBeNull();
    await act("complete.ask");
    await until(() => !!pane.draft && !!lineCompleter(pane.draft)?.shown?.items[0]?.querySuggestion, "the alias offered again");
    await act("complete.accept");
    expect(pane.draft).toBeNull();
  }, 40_000);
});
