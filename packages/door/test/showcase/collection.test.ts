import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { ITEM_BG, RULER_BG } from "../../src/surface/selection";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: a collection record (PIE-1281)", () => {
  const h = useShowcaseScreen(177);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "collection")).top; };
  const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "user" }) as Promise<any>;
  const lists = () => stage().pane("garden").surface.listsDrawn as any[];
  const ready = (layout: string) => until(() => lists().some(l => l.detail?.layout === layout && l.view.pickable().length === 4), `garden ${layout}`, 8000);
  const show = async (text: string, cols = 177) => {
    (h.app as any).term.info.cols = cols;
    await h.app.dispatch.act({ action: "section.try", args: { name: "collection" } }, { kind: "user" });
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await stage().dispatch.act({ action: "tile.close", tile: tile.name }, { kind: "user" });
    await act("tile.focus");
    const note = await h.board.createBlock(null, text);
    await act("open", { id: note.id });
    await until(() => lists().some(l => l.view.pickable().length), "the collection's rows", 8000);
    return note;
  };
  const agent = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "agent", id: "gardener" }) as Promise<any>;

  test("a saved collection opens with four layouts, sorts by a header, picks and opens", async () => {
    expect(await h.app.act({ action: "section", args: { name: "collection" }, as: "test-agent" })).toMatchObject({ key: "collection" });
    await ready("table");
    const names = lists()[0].view.pickable().map((r: any) => r.label);
    h.press({ kind: "enter" });
    await act("list.enter", { on: true });
    for (const layout of ["gallery", "feed", "board", "table"]) {
      h.press({ kind: "tab" });
      await ready(layout);
      await act("list.pick", { n: 1 });
      const picked = h.sc.render(h.app).lines.find(line => line.includes(lists()[0].view.picked().label))!;
      expect(picked).not.toContain(ITEM_BG);
      expect(picked).not.toContain(RULER_BG);
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
    const enter = (await act("elements")).elements.find((e: any) => e.kind === "control" && e.label === "⏎ in");
    expect(enter).toBeDefined();
    await act("element.open", { n: enter.n });
    await act("list.pick", { n: 1 });
    h.press({ kind: "char", ch: "j" });
    await until(() => h.screen().includes("Sort the seeds"), "the next lane's picked card is visible", 4000);
    expect(lists()[0].view.picked().label).toBe("Sort the seeds");
  }, 20_000);

  test("a grouped board keeps its picked card visible across pages", async () => {
    for (const [title, area] of [["Alpha", "Z"], ["Bravo", "Z"], ["Charlie", "A"], ["Delta", "A"]]) await h.board.createBlock(null, `${title} [collection::paged-garden] [area::${area}]`);
    await show('Paged garden\n::view{query="collection=paged-garden" layout=board group=area sort="title asc" page=2}', 44);
    expect(lists()[0].view.picked().label).toBe("Charlie");
    expect(h.screen()).toContain("Charlie");
    await act("list.pick", { n: 3 });
    expect(h.screen()).toContain("Alpha");
    expect((await act("list.blocks")).lists[0].page).toBe(2);
  }, 20_000);

  test("the collection shows its typed and kept filter", async () => {
    await show('Filtered garden\n::view{query="collection=garden" layout=table}');
    h.press({ kind: "enter" });
    await act("list.enter", { on: true });
    h.ch("/");
    let typed = "";
    for (const ch of "stage=ready") {
      h.ch(ch);
      typed += ch;
      expect(h.screen()).toContain(`/ ${typed}`);
    }
    await until(() => lists()[0]?.view.pickable().length === 3, "the typed filter answer", 8000);
    expect(h.screen()).toContain("/ stage=ready");
    h.press({ kind: "enter" });
    await until(() => lists()[0]?.view.pickable().length === 3, "the kept filter's answer", 8000);
    expect(h.screen()).toContain("/ stage=ready");
  }, 20_000);

  test("an agent's filtered rows refresh when another matching note arrives", async () => {
    await h.board.createBlock(null, "Check the beds [collection::watched-garden] [stage::ready]");
    await show('Watched garden\n::view{query="collection=watched-garden" layout=table}');
    await agent("list.filter", { words: "stage=ready" });
    const added = await h.board.createBlock(null, "Check the shed [collection::watched-garden] [stage::ready]");
    await until(() => lists()[0]?.view.pickable("gardener").some((r: any) => r.id === added.id), "the agent's watched answer", 5000);
    expect((await agent("list.blocks")).lists[0].rows.some((r: any) => r.id === added.id)).toBe(true);
  }, 20_000);

  test("an agent opens its own filtered row while the person reads another tile", async () => {
    await show('Each gardener\n::view{query="collection=garden" layout=table}');
    await act("list.filter", { words: "owner=Mira" });
    await until(() => lists()[0]?.view.pickable().length === 2, "the person sees Mira’s rows", 8000);
    await agent("list.filter", { words: "owner=Sol" });
    const row = (await agent("list.blocks")).lists[0].rows[0];
    await act("tile.open", { kind: "reader", name: "companion", note: h.seeded.notes.collection.id });
    await stage().dispatch.act({ action: "tile.focus", tile: "companion" }, { kind: "user" });
    const focus = stage().dispatch.where().focus;
    await agent("list.open", { id: row.id, where: "new" });
    expect(stage().layoutGet().tiles.some((t: any) => t.showing?.id === row.id)).toBe(true);
    expect(stage().dispatch.where().focus).toBe(focus);
  }, 20_000);

  test("a narrow table keeps an owner's link on its own field", async () => {
    const owner = await h.board.createBlock(null, "Garden keeper\n\nThe person tending this plot.");
    await h.board.createBlock(null, `Tend the plot [collection::linked-garden] [owner::((${owner.id}))] [stage::ready]`);
    await show('Linked garden\n::graph-table{query="collection=linked-garden" columns="title, owner, stage"}\n::', 44);
    const keeper = (await act("elements")).elements.find((e: any) => e.label.includes("owner:"));
    expect(keeper).toBeDefined();
    await act("element.open", { n: keeper.n });
    await until(() => stage().pane("garden").surface.msg?.id === owner.id, "the owner field opens its own note", 4000);
  }, 20_000);

  test("an embedded saved view keeps its own layout controls beside an inline collection", async () => {
    const saved = await h.board.createBlock(null, "Embedded garden [type::virtual-branch] [query::collection=garden] [layout::table, gallery] [page::2]");
    await show(`Two collections\n::view{query="collection=garden" layout=table}\n\n!((${saved.id}))`);
    await until(() => lists().length === 2, "the embedded collection is registered", 5000);
    const embedded = lists().find(l => l.title === "Embedded garden");
    expect(embedded).toBeDefined();
    await act("list.layout", { list: embedded.key, layout: "gallery" });
    await until(() => lists().find(l => l.key === embedded.key)?.detail?.layout === "gallery", "the embedded layout changes", 5000);
    expect(lists().find(l => l.key !== embedded.key)?.detail?.layout).toBe("table");
    await act("list.page", { list: embedded.key, by: 1 });
    expect((await act("list.blocks")).lists.find((l: any) => l.key === embedded.key).page).toBe(2);
  }, 20_000);

  test("an agent's full open leaves the person's focus and collection intact", async () => {
    const note = await show('Full garden\n::view{query="collection=garden" layout=table open=full}');
    await act("tile.open", { kind: "reader", name: "companion", note: h.seeded.notes.collection.id });
    await stage().dispatch.act({ action: "tile.focus", tile: "companion" }, { kind: "user" });
    const focus = stage().dispatch.where().focus;
    let refusal = "";
    try { await agent("list.open", { n: 1 }); } catch (e) { refusal = String(e); }
    expect(stage().dispatch.where().focus).toBe(focus);
    expect(stage().pane("garden").surface.msg?.id).toBe(note.id);
    expect(refusal).toMatch(/agent|focus|zoom/i);
  }, 20_000);
});
