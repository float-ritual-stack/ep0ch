import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { completionOf } from "../../src/surface/completer";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: tune the collection's own record (PIE-1483)", () => {
  const h = useShowcaseScreen(177);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "collection-tune")).top; };
  const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "user" }) as Promise<any>;
  const surface = () => stage().pane("garden").surface;
  const lists = () => { h.screen(); return surface().listsDrawn as any[]; };
  const bar = () => h.app.bar!;
  const show = async (inline = true, existing?: string) => {
    if (h.app.bar) await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
    await h.app.dispatch.act({ action: "section.try", args: { name: "collection-tune" } }, { kind: "user" });
    await act("tile.focus");
    if (surface().panel) await act("props.close");
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await stage().dispatch.act({ action: "tile.close", tile: tile.name }, { kind: "user" });
    await h.board.createBlock(null, "Other notebook [unrelated-key::outside]");
    const text = inline
      ? 'Garden settings\n\nKeep this paragraph.\n\n::view{layout=table query="collection=garden AND NOT layout=table" group=area sort="owner asc" summary-properties="title, owner, stage"} ^garden\n::\n\nKeep this too.'
      : 'Garden settings [type::virtual-branch] [query::collection=garden] [layout::table] [group::area] [sort::owner asc] [summary-properties::title, owner, stage]';
    const note = existing ? (await h.board.get(existing))! : await h.board.createBlock(null, text);
    await act("open", { id: note.id });
    await until(() => surface().msg?.id === note.id && lists().some(l => l.view.pickable().length === 4), "garden rows", 8000);
    return note;
  };

  test("comma opens the existing settings card over an inline view", async () => {
    const note = await show();
    await act("list.enter", { on: true });
    h.ch(",");
    await until(() => !!surface().panel?.card, "the inline view's settings card", 1500);
    expect(h.screen()).toContain("settings · Views");
    expect(h.screen()).toContain("Water the beans");
    expect((await act("settings")).fields.find((f: any) => f.key === "layout").value).toBe("table");
    expect((await h.board.get(note.id))!.text).toBe(note.text);
  }, 20_000);

  test("a toggle redraws the board and writes only the inline view's keys", async () => {
    const note = await show();
    await act("settings.toggle", { key: "layout", value: "board" });
    await act("settings.toggle", { key: "layout", value: "table" });
    const text = (await h.board.get(note.id))!.text;
    expect(text).toContain('layout="board"');
    expect(text).toContain('query="collection=garden AND NOT layout=table"');
    await until(() => lists()[0]?.detail.layout === "board", "board under the card", 5000);
    expect(text).toContain("^garden");
    expect(text).toContain("Keep this paragraph.");
    expect(text).toContain("Keep this too.");
    expect(text).not.toContain("[layout::");
    expect(h.screen()).toContain("beds");
  }, 20_000);

  test("pick-order reorders sort and toggles a visible property on the saved view", async () => {
    const note = await show(false);
    await act("settings");
    await act("settings.toggle", { key: "sort", value: "stage desc" });
    await act("settings.set", { key: "sort" });
    await until(() => !!bar()?.items.length, "sort question", 3000);
    await h.app.dispatch.act({ action: "bar.question", args: { op: "move", value: "stage desc", by: -1 } }, { kind: "user" });
    expect((await h.board.get(note.id))!.text).toContain("[sort::stage desc, owner asc]");
    await h.app.dispatch.act({ action: "bar.edit", args: { op: "paste", text: "stage" } }, { kind: "user" });
    await until(() => bar().items.some(i => i.row.key === "later:stage desc"), "filtered order choices");
    await h.app.dispatch.act({ action: "bar.pick", args: { n: bar().items.findIndex(i => i.row.key === "later:stage desc") + 1 } }, { kind: "user" });
    expect(bar().query).toBe("stage");
    expect((await h.board.get(note.id))!.text).toContain("[sort::owner asc, stage desc]");
    await h.app.dispatch.act({ action: "bar.pick", args: { n: bar().items.findIndex(i => i.row.key === "earlier:stage desc") + 1 } }, { kind: "user" });
    await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
    await act("settings.toggle", { key: "summary-properties", value: "owner" });
    expect((await h.board.get(note.id))!.text).toContain("[summary-properties::title, stage]");
    await until(() => lists()[0]?.detail.sort === "stage desc, owner asc", "reordered rows", 5000);
    expect(lists()[0].view.pickable()[0].label).toBe("Water the beans");
  }, 20_000);

  test("the facet picker offers this view's keys and explains a miss with its nearest key", async () => {
    const note = await show(false);
    await act("settings.set", { key: "group" });
    await until(() => !!bar()?.items.length, "group facets", 3000);
    const rows = bar().items.map((i: any) => i.row.label).join("\n");
    expect(rows).toContain("owner");
    expect(rows).toContain("stage");
    expect(rows).not.toContain("unrelated-key");
    await h.app.dispatch.act({ action: "bar.edit", args: { op: "paste", text: "ow" } }, { kind: "user" });
    h.press({ kind: "tab" });
    await until(() => !!completionOf(bar().input)?.items.length, "facet completion");
    expect(completionOf(bar().input)!.items.some(i => i.insertion === "owner")).toBe(true);
    h.press({ kind: "tab" });
    await until(() => bar().query === "owner", "facet inserted in the shared input");
    await h.app.dispatch.act({ action: "bar.edit", args: { op: "clear" } }, { kind: "user" });
    await h.app.dispatch.act({ action: "bar.edit", args: { op: "paste", text: "owenr" } }, { kind: "user" });
    expect(bar().items.map(i => i.row.label).join(" ")).toMatch(/no notes have owenr.*owner/);
    await expect(h.app.dispatch.act({ action: "bar.pick", args: { n: 1 } }, { kind: "user" })).rejects.toThrow(/no notes have owenr.*owner/);
    expect(bar().query).toBe("owenr");
    await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
    await expect(act("settings.toggle", { key: "group", value: "owenr" })).rejects.toThrow(/no notes have owenr.*owner/);
    expect((await h.board.get(note.id))!.text).toBe(note.text);
    const captured = await act("settings.set", { key: "group", value: "owenr" });
    expect(captured.warnings.join(" ")).toMatch(/no notes have owenr.*owner/);
    expect((await h.board.get(note.id))!.text).toContain("[group::owenr]");
  }, 20_000);

  test("an unanchored YAML view writes its own keys and leaves the other view alone", async () => {
    await show();
    const note = await h.board.createBlock(null, ['Two gardens', '', '::view', '---', 'query: collection=garden', 'layout: table', 'sort:', '  - owner asc', '  - stage desc', '---', '::', '', '::view{query="collection=garden" layout=feed}', '::'].join("\n"));
    await act("open", { id: note.id });
    await until(() => surface().msg?.id === note.id && lists().length === 2 && lists().every(l => l.view.pickable().length === 4), "both views");
    const list = lists()[0].key;
    await act("settings", { list });
    await act("settings.toggle", { key: "layout", value: "board" });
    await act("settings.set", { key: "sort", value: "stage desc, owner asc" });
    await until(() => lists()[0].detail.layout === "board" && lists()[1].detail.layout === "feed", "two independent view records");
    const saved = (await h.board.get(note.id))!.text;
    expect(saved).toContain('layout: "board, table"');
    expect(saved).toContain('sort: "stage desc, owner asc"');
    expect(saved).toContain('::view{query="collection=garden" layout=feed}');
    expect(saved).not.toContain("  - owner asc");
  }, 20_000);

  test("a boxed view tunes its own source after an earlier view", async () => {
    await show();
    const before = '::view{query="collection=garden" layout=feed} ^outside';
    const note = await h.board.createBlock(null, ['Two gardens', '', before, '::', '', '::box{pad=1}', '::view{query="collection=garden" layout=table}', '::', '::'].join("\n"));
    await act("open", { id: note.id });
    await until(() => surface().msg?.id === note.id && lists().length === 2 && lists().every(l => l.view.pickable().length === 4), "the outside and boxed gardens");
    await act("settings", { list: lists()[1].key });
    await act("settings.toggle", { key: "layout", value: "board" });
    await until(() => lists()[0].detail.layout === "feed" && lists()[1].detail.layout === "board", "only the boxed garden changed");
    const saved = (await h.board.get(note.id))!.text;
    expect(saved).toContain(before);
    expect(saved).toContain('::box{pad=1}\n::view{query="collection=garden" layout="board, table"}');
  }, 20_000);

  test.each([
    ['indentless list', ['query: collection=garden', 'sort:', '- owner asc', '- stage desc', '# keep the group', 'group: area']],
    ['indented mapping', ['  query: collection=garden', '  sort:', '    - owner asc', '    - stage desc', '  # keep the group', '  group: area']],
  ])("an %s keeps valid YAML and neighboring fields when sort changes", async (_name, yaml) => {
    await show();
    const note = await h.board.createBlock(null, ['Garden YAML', '', '::view', '---', ...yaml, '---', '::'].join("\n"));
    await act("open", { id: note.id });
    await until(() => surface().msg?.id === note.id && lists()[0]?.view.pickable().length === 4, "the YAML garden");
    await act("settings.set", { key: "sort", value: "stage desc, owner asc" });
    const saved = (await h.board.get(note.id))!.text;
    expect(saved).not.toContain("- owner asc");
    expect(saved).toContain("# keep the group");
    expect(saved).toContain("group: area");
    await until(() => lists()[0]?.detail.sort === "stage desc, owner asc" && lists()[0]?.view.pickable().length === 4, "the changed YAML garden still renders");
  }, 20_000);

  test("a hidden title column can be restored and record fields can be picked for sorting", async () => {
    await show(false);
    await act("settings.toggle", { key: "summary-properties", value: "title" });
    await act("settings.set", { key: "summary-properties" });
    expect(bar().items.some(i => i.row.key === "toggle:title")).toBe(true);
    await h.app.dispatch.act({ action: "bar.question", args: { op: "toggle", value: "title" } }, { kind: "user" });
    await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
    await act("settings.set", { key: "sort" });
    for (const field of ["title", "created", "updated"]) expect(bar().items.some(i => i.row.key === `toggle:${field} asc`)).toBe(true);
    await h.app.dispatch.act({ action: "bar.question", args: { op: "toggle", value: "title asc" } }, { kind: "user" });
    await until(() => lists()[0]?.detail.sort === "owner asc, title asc", "title sorting reaches the view record");
    await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
  }, 20_000);

  test("an agent's binding is attributed without taking keys, and a stale revision refuses and re-reads", async () => {
    const note = await show();
    await act("list.enter", { on: true });
    await act("list.pick", { n: 2 });
    await act("settings");
    const picked = lists()[0].view.picked().id, selected = surface().panel!.card!.sel;
    await act("tile.open", { kind: "reader", name: "beside" });
    const focus = stage().focusedName();
    const agent = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "agent", id: "gardener" }) as Promise<any>;
    const read = await agent("settings");
    await agent("binding.set", { revision: read.revision, key: "layout", value: "board" });
    await until(() => lists()[0].detail.layout === "board", "agent's layout");
    expect(stage().focusedName()).toBe(focus);
    expect(lists()[0].view.picked().id).toBe(picked);
    expect(surface().panel!.card!.sel).toBe(selected);
    expect((await h.board.revisions(note.id)).revisions[0]).toMatchObject({ author: "agent", actorId: "gardener" });
    const before = (await h.board.get(note.id))!;
    await expect(agent("binding.set", { revision: read.revision, key: "layout", value: "feed" })).rejects.toThrow(/changed elsewhere.*not saved/);
    expect((await h.board.get(note.id))!.text).toBe(before.text);
    expect(surface().msg!.revision).toBe(before.revision);
    await stage().dispatch.act({ action: "tile.close", tile: "beside" }, { kind: "user" });
    await act("tile.focus");
  }, 20_000);

  test("a settings tile hosts the same inline card and write binding", async () => {
    const note = await show();
    await act("tile.open", { kind: "settings", name: "tune", note: note.id, view: "^garden" });
    const tune = () => stage().pane("tune").surface;
    await until(() => !!tune().panel?.card, "settings tile's card");
    await stage().dispatch.act({ action: "settings.toggle", tile: "tune", args: { key: "layout", value: "board" } }, { kind: "agent", id: "gardener" });
    await until(() => lists()[0].detail.layout === "board", "the source view follows its settings tile");
    expect((await h.board.get(note.id))!.text).toContain('layout="board, table"');
    expect(tune().msg.id).toBe(note.id);
    await stage().dispatch.act({ action: "tile.close", tile: "tune" }, { kind: "user" });
    await act("tile.focus");
  }, 20_000);

  test("the seeded garden tunes by keys, mouse and act at 177 and 44 columns", async () => {
    const original = (await h.board.get(h.seeded.notes.collectionTune.id))!;
    for (const cols of [177, 44]) {
      h.app.t.cols = cols;
      const now = (await h.board.get(original.id))!;
      await h.board.update(now.id, original.text, now.revision!, { kind: "user" });
      const note = await show(true, original.id);
      h.ch(",");
      await until(() => !!surface().panel?.card, "seeded view's card");
      const settings = await act("settings");
      const layoutAt = settings.fields.findIndex((f: any) => f.key === "layout");
      for (let i = 0; i < layoutAt; i++) h.press({ kind: "down" });
      h.press({ kind: "enter" });
      await until(() => bar()?.items.some(i => i.row.key === "toggle:board") ?? false, "layout question from the card");
      await h.app.dispatch.act({ action: "bar.edit", args: { op: "paste", text: "bo" } }, { kind: "user" });
      h.press({ kind: "tab" });
      await until(() => !!completionOf(bar().input)?.items.some(i => i.insertion === "board"), "layout enum completion");
      h.press({ kind: "tab" });
      await until(() => bar().query === "board", "board completed");
      h.press({ kind: "enter" });
      await until(() => lists()[0].detail.layout === "board", "board under the open card");
      await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
      await act("settings.set", { key: "sort" });
      h.press({ kind: "down" });
      h.ch("K");
      await until(() => lists()[0].detail.sort === "stage desc, owner asc", "sort moved by K");
      h.ch("J");
      await until(() => lists()[0].detail.sort === "owner asc, stage desc", "same choice moved by J");
      h.ch("K");
      await until(() => lists()[0].detail.sort === "stage desc, owner asc", "same choice moved back by K");
      await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
      await act("settings.set", { key: "summary-properties" });
      const draw = bar().draw(cols, 59), lines = draw.lines.map(s => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, ""));
      const row = lines.findIndex(s => s.includes("[x] owner"));
      expect(row).toBeGreaterThan(-1);
      const x = draw.rect.col + lines[row]!.indexOf("[x] owner") + 2, y = draw.rect.row + row;
      for (let n = 0; n < 2; n++) {
        h.press({ kind: "mouse", action: "down", button: 0, x, y });
        h.press({ kind: "mouse", action: "up", button: 0, x, y });
      }
      await until(() => bar().items.some(i => i.row.key === "toggle:owner" && i.row.label.startsWith("[ ]")), "owner hidden by click");
      await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
      const saved = (await h.board.get(note.id))!.text;
      expect(saved).toContain('layout="board, table"');
      expect(saved).toContain('sort="stage desc, owner asc"');
      expect(saved).toContain('summary-properties="title, stage"');
      expect(h.screen()).toContain("settings · Views");
      expect(h.screen()).toContain("beds");
    }
    h.app.t.cols = 177;
  }, 30_000);
});
