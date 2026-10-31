import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: a collection record (PIE-1281)", () => {
  const h = useShowcaseScreen(177);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "collection")).top; };
  const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "user" }) as Promise<any>;
  const lists = () => stage().pane("garden").surface.listsDrawn as any[];
  const ready = (layout: string) => until(() => lists().some(l => l.detail?.layout === layout && l.view.pickable().length === 4), `garden ${layout}`, 8000);

  test("a saved collection opens with four layouts, sorts by a header, picks and opens", async () => {
    expect(await h.app.act({ action: "section", args: { name: "collection" }, as: "test-agent" })).toMatchObject({ key: "collection" });
    await ready("table");
    const names = lists()[0].view.pickable().map((r: any) => r.label);
    h.press({ kind: "enter" });
    await act("list.enter", { on: true });
    for (const layout of ["gallery", "feed", "board", "table"]) {
      h.press({ kind: "tab" });
      await ready(layout);
      expect(lists()[0].view.pickable().map((r: any) => r.label).sort()).toEqual([...names].sort());
      expect(h.screen()).toContain("Water the beans");
      if (layout === "feed") expect(h.screen()).toContain("Water at dusk");
      if (layout === "board") expect(h.screen()).toContain("NONE");
    }
    const elements = (await act("elements")).elements;
    const header = elements.find((e: any) => e.label.trim() === "title" && e.kind === "control");
    expect(header).toBeDefined();
    await act("button.press", { n: header.n });
    await until(() => lists()[0]?.detail?.sort === "title desc", "the header's descending sort", 8000);
    expect(lists()[0].view.pickable()[0].label).toBe("Water the beans");
    await act("list.pick", { n: 2 });
    const selected = lists()[0].view.picked().id;
    await act("list.open");
    await until(() => stage().pane("garden").surface.msg?.id === selected, "the selected garden note opens", 8000);
    h.press({ kind: "esc" });
  }, 30_000);

  test("an old graph-table is the table preset of the inline view, with the same rows and list actions", async () => {
    await h.app.dispatch.act({ action: "section", args: { name: "collection" } }, { kind: "user" });
    const note = await h.board.createBlock(null, [
      "Two spellings for the garden",
      '::view{query="collection=garden" layout=table page=2 summary-properties="title, owner" sort="title asc"} ^new', "",
      '::graph-table{query="collection=garden" columns="title, owner" sort="title asc" open=beside} ^old', "::",
    ].join("\n"));
    await act("open", { id: note.id });
    await until(() => lists().length === 2 && lists().every(l => l.view.pickable().length === 4), "both spellings have list rows", 8000);
    const both = (await act("list.blocks")).lists;
    expect(both.map((l: any) => l.key)).toEqual(["^new", "^old"]);
    expect(both[0].rows).toEqual(both[1].rows);
    expect(await stage().dispatch.act({ action: "list.page", tile: "garden", args: { list: "^new", by: 1 } }, { kind: "agent", id: "gardener" })).toMatchObject({ page: 2 });
    expect((await act("list.blocks")).lists[0].page).toBe(1);
    await act("list.pick", { list: "^old", n: 3 });
    expect(lists()[1].view.picked().label).toBe("Wash the pots");
    const wanted = lists()[1].view.picked().id;
    await act("list.open", { list: "^old" });
    await until(() => stage().layoutGet().tiles.some((t: any) => t.name !== "garden" && t.showing?.id === wanted), "the row opens beside its collection", 4000);
    expect(stage().pane("garden").surface.msg.id).toBe(note.id);
  }, 20_000);

  test("a narrow board follows the picked row into its lane", async () => {
    (h.app as any).term.info.cols = 44;
    await h.app.dispatch.act({ action: "section.try", args: { name: "collection" } }, { kind: "user" });
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await stage().dispatch.act({ action: "tile.close", tile: tile.name }, { kind: "user" });
    await act("tile.focus");
    await act("open", { id: h.seeded.notes.collection.id });
    await ready("table");
    await act("list.layout", { layout: "board" });
    await ready("board");
    await act("list.enter", { on: true });
    await act("list.pick", { n: 1 });
    h.press({ kind: "char", ch: "j" });
    await until(() => h.screen().includes("Sort the seeds"), "the next lane's picked card is visible", 4000);
    expect(lists()[0].view.picked().label).toBe("Sort the seeds");
  }, 20_000);
});
