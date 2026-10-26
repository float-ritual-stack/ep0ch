// The sticky pad section (PIE-1247): a long plan's figure, with no heading over it, embedded in a pad by its page; the
// figure still reads its own note's children (PIE-745); the links tile says which anchor the pad aims at; and an agent,
// through act, lists the plan's callout and list items under `!((Raised` and embeds one, its anchor written for it.
// Scratch service, made-up notes.
import { describe, expect, test } from "bun:test";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: sticky pad (PIE-1247)", () => {
  const h = useShowcaseScreen(200);
  const { S } = h;
  const stage = () => S().stages.get(S().sel).top;
  const draft = () => stage().pane("pad").surface.draft;
  const as = "test-agent";

  test("the pad embeds only the plan's figure, which reads the plan's children; the links tile names the anchor; an agent embeds the callout by (( completion", async () => {
    await h.app.act({ action: "section", args: { name: "sticky-pad" }, as });
    await until(() => marks["sticky-pad"]!.every(m => h.screen().includes(m)), `the sticky pad section: ${marks["sticky-pad"]!.filter(m => !h.screen().includes(m)).join(" | ")}`, 15_000);
    const pad = h.seeded.notes.stickyPad.id, plan = h.seeded.notes.stickyPlan.id;
    // The pad's tile: the figure, answered from the plan's children, and none of the plan's other prose.
    await until(() => h.screen().includes("» Raised beds plan ^bed-jobs"), "the pad's embed", 15_000);
    // The pad is the middle of three tiles side by side: what each row has between the first and second tiles' borders.
    const padRows = () => h.screen().split("\n").map(l => l.split("││")[1] ?? "").join("\n");
    await until(() => padRows().includes("Turn the compost"), "the figure's rows in the pad", 15_000);
    expect(padRows()).not.toContain("The rest of the plan");
    // The links tile follows the plan: the pad's link and embed, grouped by the anchor each aims at.
    await until(() => h.screen().includes("page link ^bed-j"), "the links tile's groups", 15_000);
    const [source] = (await h.board.request<{ sources: { blockId: string; referenceGroups: unknown[] }[] }>("references.backlinks", { query: { targetBlockId: plan, limit: 10 } })).sources;
    expect(source).toMatchObject({ blockId: pad, referenceGroups: [{ kind: "page", count: 1 }, { kind: "page", fragmentId: "bed-jobs", count: 1 }] });

    // An agent asks what `!((Raised beds` offers in the pad: the plan's figure (anchored), callout and list items.
    const r = await h.app.act({ action: "complete", args: { text: "!((Raised beds plan" }, tile: "pad", as }) as { items: { label: string; insertion: string }[] };
    const labels = r.items.map(i => i.label.trim());
    expect(labels, labels.join("\n")).toContain("^bed-jobs  :: Bed jobs");
    expect(labels).toContain("[!] Water early · adds ^water-early");
    expect(labels).toContain("- stake the peas · adds ^stake-the-peas");

    // In an edit of its own, it types the embed and inserts the callout: the plan gains the anchor, attributed.
    await h.app.act({ action: "edit", tile: "pad", as });
    await until(() => !!draft(), "the agent's edit open");
    const last = draft().text.split("\n").length;
    await h.app.act({ action: "draft.place", tile: "pad", args: { line: last, col: draft().text.split("\n").at(-1).length + 1 }, as });
    await h.app.act({ action: "draft.paste", tile: "pad", args: { text: "\n!((Raised beds plan" }, as });
    const offered = await h.app.act({ action: "complete", tile: "pad", as }) as { items: { label: string; insertion: string }[] };
    const n = offered.items.findIndex(i => i.label.includes("Water early")) + 1;
    expect(n).toBeGreaterThan(0);
    await h.app.act({ action: "complete", tile: "pad", args: { insert: n, expect: offered.items[n - 1]!.insertion }, as });
    await until(() => draft().text.endsWith(`!((${plan}^water-early))`), "the callout embedded", 10_000);
    expect((await h.board.get(plan))!.text).toContain("> Before nine, so the leaves dry by noon. ^water-early");
    await h.app.act({ action: "edit.save", tile: "pad", as });
    await until(() => !draft(), "the pad saved");
    expect((await h.board.get(pad))!.text).toEndWith(`!((${plan}^water-early))`);
    await until(() => padRows().includes("» Raised beds plan ^water-early") && padRows().includes("Water early"), "the callout drawn in the pad", 15_000);
  }, 90_000);
});
