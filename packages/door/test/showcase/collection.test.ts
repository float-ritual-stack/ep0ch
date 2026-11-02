import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { ITEM_BG, RULER_BG } from "../../src/surface/selection";
import { PERSON } from "../../src/surface/list-view";
import { visible } from "../../src/style";
import { PostIt } from "../../src/desk/post-it";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: a collection record (PIE-1281)", () => {
  const h = useShowcaseScreen(177);
  let section = "collection";
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === section)).top; };
  const act = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "user" }) as Promise<any>;
  const lists = () => stage().pane("garden").surface.listsDrawn as any[];
  const ready = (layout: string) => until(() => lists().some(l => l.detail?.layout === layout && l.view.pickable().length === 4), `garden ${layout}`, 8000);
  const show = async (text: string, cols = 177) => {
    section = "collection";
    (h.app as any).term.info.cols = cols;
    await h.app.dispatch.act({ action: "section.try", args: { name: "collection" } }, { kind: "user" });
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await stage().dispatch.act({ action: "tile.close", tile: tile.name }, { kind: "user" });
    await act("tile.focus");
    const note = await h.board.createBlock(null, text);
    await act("open", { id: note.id });
    await until(() => stage().pane("garden").surface.msg?.id === note.id && lists().some(l => l.view.pickable().length), "the collection's rows", 8000);
    return note;
  };
  const agent = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "agent", id: "gardener" }) as Promise<any>;

  /** The collection whose row the [ ] position is on (no mode, PIE-1501). */
  const onRow = () => { const link = stage().pane("garden").surface.selectedElement()?.link; return !!link?.listRow?.row && lists().some(l => l.key === link.listRow.key); };
  test.each([120, 44])("round two feed reads the note and the collection's keys work from its row, with no mode, at %s columns", async cols => {
    const first = await h.board.createBlock(null, `Check the parcel [collection::feed-${cols}] [to::Mira] [stage::waiting]\n\n> [!success]\n> **Ready** for {{this.to}}.\n\n## Before it travels [heading::tab]\n\n- #garden\n\nPack the seeds.`);
    const second = await h.board.createBlock(null, `Read the field report [collection::feed-${cols}] [stage::ready]\n\nThe beds are watered.`);
    const note = await show(`Needs a gardener [type::virtual-branch] [query::collection=feed-${cols}] [layout::feed, table, board] [body::20] [sort::title asc] [group::stage]`, cols);
    await until(() => h.screen().includes("Ready") && h.screen().includes("Mira."), "the feed resolves the card's own values", 1500);
    const text = h.screen();
    expect(text).not.toContain("[!success]");
    expect(text).not.toContain("**Ready**");
    expect(text).not.toContain("{{this.to}}");
    expect(text).not.toContain("[heading::tab]");
    expect(text.toLowerCase()).toContain("before it");
    expect(text.toLowerCase()).toContain("travels");
    expect(h.sc.render(h.app).lines.find(line => visible(line).includes("Ready"))).toContain("\x1b[1m");
    for (const layout of ["feed", "table", "board"]) {
      await act("list.layout", { layout });
      expect(h.screen()).not.toContain("{{this.to}}");
      await act("list.enter", { on: true });
      const rows = lists()[0].view.pickable();
      await act("list.pick", { n: 1 });
      expect(onRow()).toBe(true);
      expect(lists()[0].entered).toBe(false);
      h.ch("j");
      await until(() => lists()[0].view.picked().id === rows[1].id, `${layout} j picks the next note`);
      h.press({ kind: "up" });
      await until(() => lists()[0].view.picked().id === rows[0].id, `${layout} up picks the first note`);
      const hint = stage().pane("garden").surface.contextualHint();
      expect(hint).toContain("pick");
      expect(hint).toContain(", tune");
      expect(hint).not.toContain("leave");
      expect(hint).toContain("[ ]");
      // p is the reader's own key on a row, as on a figure's: no mode holds it.
      h.ch("p");
      await until(() => stage().pane("garden").pinned, `${layout} p pins the reader from a row`);
      h.ch("p");
      await until(() => !stage().pane("garden").pinned, `${layout} p unpins it`);
      expect(onRow()).toBe(true);
      expect(lists()[0].detail.layout).toBe(layout);
      // Esc lets go of the row, as of any element; j from the block walks back onto its first row.
      h.press({ kind: "esc" });
      await until(() => !onRow(), `${layout} Escape lets go of the row`);
      expect(stage().pane("garden").surface.msg.id).toBe(note.id);
    }
  }, 20_000);

  test.each([120, 44])("round two j alone walks into the collection, through it and out, in every layout at %s columns", async cols => {
    for (const title of ["Mend the fence", "Oil the gate", "Sweep the shed"]) await h.board.createBlock(null, `${title} [collection::walk-${cols}] [stage::ready]`);
    const note = await show(`Needs a hand [type::virtual-branch] [query::collection=walk-${cols}] [layout::table, feed, board] [sort::title asc]\n\nA line before the list.\n\nAnother line before it.`, cols);
    const surface = () => stage().pane("garden").surface;
    const entered = () => lists()[0]?.view.hasPick(PERSON) === true && onRow();
    const picked = () => lists()[0].view.picked().label as string;
    const hint = () => surface().contextualHint() ?? "";
    for (const layout of ["table", "feed", "board"]) {
      await act("list.layout", { layout });
      await until(() => lists()[0].detail.layout === layout, `${layout} drawn`);
      await act("reading.place", { line: 1 });
      // j alone: the first body lines, then the collection's first row, with the collection's own hint.
      for (let i = 0; i < 4 && !entered(); i++) { h.ch("j"); await new Promise(r => setTimeout(r, 120)); }
      await until(entered, `${layout}: j walks into the collection`);
      expect(picked()).toBe("Mend the fence");
      expect(hint()).toContain("pick");
      expect(hint()).not.toContain("leave");
      h.ch("j"); await until(() => picked() === "Oil the gate", `${layout}: j moves to the second row`);
      h.ch("j"); await until(() => picked() === "Sweep the shed", `${layout}: j moves to the last row`);
      // The collection ends the note: j past its last row stays on that row. k walks back up and out to the line before; j walks back in.
      h.ch("j"); await new Promise(r => setTimeout(r, 250));
      expect(entered()).toBe(true); expect(picked()).toBe("Sweep the shed");
      h.ch("k"); h.ch("k"); await until(() => picked() === "Mend the fence", `${layout}: k moves back to the first row`);
      h.ch("k"); await until(() => !entered(), `${layout}: k before the first row leaves the collection`);
      expect(hint() ?? "").not.toContain("pick");
      expect(surface().msg.text.slice(surface().position.reading)).toStartWith("Another line before it.");
      h.ch("j"); await until(() => entered() && picked() === "Mend the fence", `${layout}: j walks back in at the first row`);
      // Esc lets go of the row and stays on the note; j from its block lands on the first row again.
      h.press({ kind: "esc" }); await until(() => !entered(), `${layout}: esc lets go of the row`);
      expect(surface().msg.id).toBe(note.id);
      h.ch("j"); await until(entered, `${layout}: j lands on the first row again`);
      expect(hint()).toContain("pick");
      // ] walks the elements: from the first row onto the second; [ back.
      h.ch("]"); await until(() => picked() === "Oil the gate", `${layout}: ] steps to the second row`);
      h.ch("["); await until(() => picked() === "Mend the fence", `${layout}: [ steps back`);
      h.press({ kind: "esc" }); await until(() => !entered(), `${layout}: esc lets go again`);
    }
  }, 30_000);

  test("round two Sources describes and asks the saved collection again", async () => {
    await h.board.createBlock(null, "Check the gate [collection::source-garden]");
    await show("Needs a gardener [type::virtual-branch] [query::collection=source-garden] [layout::feed]");
    const answer = await act("sources.open");
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0]).toMatchObject({ params: expect.arrayContaining([{ key: "query", value: "collection=source-garden" }]), rows: 1, readAt: expect.any(String) });
    await act("sources.enter", { n: 1 });
    expect(h.screen()).toContain("feed");
    expect(h.screen()).toContain("Check the gate");
    await h.board.createBlock(null, "Read the seed report [collection::source-garden]");
    h.ch("r");
    await until(() => h.screen().includes("Read the seed report"), "r asks the collection again");
    expect(h.screen()).toContain("2 rows");
    h.press({ kind: "esc" });
  }, 20_000);

  test.each([120, 44])("a plain saved view stays quiet and names its notes at %s columns", async cols => {
    try {
      section = "quiet-collection";
      h.app.t.cols = cols;
      await h.app.dispatch.act({ action: "section.try", args: { name: section } }, { kind: "user" });
      await act("tile.focus");
      await act("open", { id: h.seeded.notes.collectionQuiet.id });
      await until(() => lists()[0]?.view.pickable().length === 2, "waiting garden rows");
      const rendered = () => { h.app.flush(); return h.painted.map(visible); };
      const cell = (word: string) => { const lines = rendered(), y = lines.findIndex(line => line.includes(word)); expect(y).toBeGreaterThan(-1); return { x: lines[y]!.indexOf(word) + 1, y }; };
      const click = (word: string) => { const at = cell(word); h.press({ kind: "mouse", action: "down", button: 0, ...at }); h.press({ kind: "mouse", action: "up", button: 0, ...at }); };
      const controls = () => rendered().filter(line => /table.* · /.test(line));
      expect(controls()).toEqual([]);
      expect(h.screen()).not.toContain("tab in a collection");
      expect(h.screen()).toContain("Check seeds");
      expect(h.screen()).toContain("Read report");
      expect(h.screen()).toContain("2 notes");
      const report = (await act("elements")).elements.find((e: any) => e.label.includes("Read report") && e.kind === "row");
      await act("element.select", { n: report.n });
      expect(controls()).toHaveLength(1);
      if (cols === 120) expect(h.sc.render(h.app).lines.find(line => line.includes("Read report"))).toContain(ITEM_BG);
      await act("element.select", { n: 0 });
      expect(controls()).toEqual([]);
      await h.app.dispatch.act({ action: "text.hover", args: cell("Check seeds") }, { kind: "user" });
      expect(controls()).toHaveLength(1);
      expect(lists()[0].entered).toBe(false);
      const control = controls()[0]!, settingsAt = { x: control.indexOf("≡"), y: rendered().indexOf(control) };
      h.press({ kind: "mouse", action: "down", button: 0, ...settingsAt });
      h.press({ kind: "mouse", action: "up", button: 0, ...settingsAt });
      await until(() => !!stage().pane("garden").surface.panel?.card, "hovered settings opens by click");
      h.press({ kind: "esc" });
      await until(() => !stage().pane("garden").surface.panel, "settings closes");
      const settings = (await act("elements")).elements.find((e: any) => e.kind === "control" && e.label.includes("≡"));
      await act("element.select", { n: settings.n });
      h.press({ kind: "enter" });
      await until(() => !!stage().pane("garden").surface.panel?.card, "Enter presses the selected settings control", 1500);
      h.press({ kind: "esc" });
      await until(() => !stage().pane("garden").surface.panel, "Enter's card closes");
      await act("element.select", { n: 0 });
      await h.app.dispatch.act({ action: "text.hover", args: { x: 0, y: 0 } }, { kind: "user" });
      expect(controls()).toEqual([]);
      if (cols === 120) {
        await h.app.dispatch.act({ action: "glass.mode", args: { set: "on" } }, { kind: "user" });
        await h.app.dispatch.act({ action: "glass.tune", args: { name: "open", value: 0 } }, { kind: "user" });
        const preview = () => { const p = h.app.glass.floats().find(f => f.pane instanceof PostIt && f.pane.hover)?.pane; return p instanceof PostIt ? p.msg : undefined; };
        const seeds = lists()[0].view.pickable().find((row: any) => row.label === "Check seeds").id;
        const report = lists()[0].view.pickable().find((row: any) => row.label === "Read report").id;
        await h.app.dispatch.act({ action: "text.hover", args: cell("Check seeds") }, { kind: "user" });
        await until(() => preview()?.id === seeds, "the first row's hover preview");
        await h.app.dispatch.act({ action: "text.hover", args: cell("sort") }, { kind: "user" });
        await until(() => preview()?.text === "sort", "the control's text preview");
        await h.app.dispatch.act({ action: "text.hover", args: cell("Read report") }, { kind: "user" });
        await until(() => preview()?.id === report, "hover follows the second row after a control", 1500);
        await h.app.dispatch.act({ action: "glass.mode", args: { set: "off" } }, { kind: "user" });
      }
      click("Read report");
      await until(() => onRow() && lists()[0].view.picked().label === "Read report", "click picks the report");
      expect(lists()[0].entered).toBe(false);
      expect(controls()).toHaveLength(1);
      if (cols === 120) expect(h.sc.render(h.app).lines.find(line => line.includes("Read report"))).toContain(ITEM_BG);
      else expect(h.screen()).toContain("▸ Read report");
      expect(stage().pane("garden").surface.contextualHint()).toContain(", tune");
      h.press({ kind: "up" });
      await until(() => lists()[0].view.picked().label === "Check seeds", "arrow picks the other note");
      h.ch(",");
      await until(() => !!stage().pane("garden").surface.panel?.card, "comma opens settings");
      h.press({ kind: "esc" });
      await until(() => !stage().pane("garden").surface.panel, "comma's card closes");
      const picked = lists()[0].view.picked().id;
      h.press({ kind: "enter" });
      await until(() => stage().pane("garden").surface.msg?.id === picked, "Enter opens the picked note");
    } finally {
      await h.app.dispatch.act({ action: "text.hover", args: { x: 0, y: 0 } }, { kind: "user" });
      await h.app.dispatch.act({ action: "glass.clear" }, { kind: "user" });
      await h.app.dispatch.act({ action: "glass.mode", args: { set: "off" } }, { kind: "user" });
      await h.app.dispatch.act({ action: "section.leave" }, { kind: "user" });
      section = "collection";
      h.app.t.cols = 177;
    }
  }, 20_000);

  test("a saved collection opens with four layouts, sorts by a header, picks and opens", async () => {
    expect(await h.app.dispatch.act({ action: "section", args: { name: "collection" } }, { kind: "user" })).toMatchObject({ key: "collection" });
    await act("open", { id: h.seeded.notes.collection.id });
    await ready("table");
    const names = lists()[0].view.pickable().map((r: any) => r.label);
    h.press({ kind: "enter" });
    await act("list.enter", { on: true });
    for (const layout of ["gallery", "feed", "board", "table"]) {
      await act("list.layout", { layout });
      await ready(layout);
      await act("list.pick", { n: 1 });
      const picked = h.sc.render(h.app).lines.find(line => line.includes(lists()[0].view.picked().label))!;
      if (layout === "table") expect(picked).toContain(ITEM_BG);
      else expect(picked).not.toContain(ITEM_BG);
      expect(picked).not.toContain(RULER_BG);
      expect(lists()[0].view.pickable().map((r: any) => r.label).sort()).toEqual([...names].sort());
      expect(h.screen()).toContain("Water the beans");
      if (layout === "feed") await until(() => h.screen().includes("Water at dusk"), "the feed reads its notes");
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

  test.each(["person", "agent"])("review1134: %s keeps the picked note when changing from table to board", async who => {
    const query = `review-switch-${who}`;
    await h.board.createBlock(null, `Aster [collection::${query}] [bed::A]`);
    const picked = await h.board.createBlock(null, `Bluebell [collection::${query}] [bed::B]`);
    await show(`Flower layouts\n::view{query="collection=${query}" layout="table, board" group=bed sort="title asc"}`);
    const run = who === "person" ? act : agent;
    await run("list.pick", { id: picked.id });
    await run("list.layout", { layout: "board" });
    h.screen();
    if (who === "agent") {
      await act("tile.open", { kind: "reader", name: "companion", note: h.seeded.notes.collection.id });
      await stage().dispatch.act({ action: "tile.focus", tile: "companion" }, { kind: "user" });
    }
    const opened = await run("list.open");
    expect(opened.opened).toBe(picked.id);
  }, 20_000);

  test("picking a live table row reveals its full description", async () => {
    const description = "Carry the seedlings through the orchard, past the potting shed and along the fence. Water each tray before setting it beside the beds, then check that the gate is closed and leave the empty watering can beside the";
    await h.board.createBlock(null, `Aster [collection::row-expansion] [description::${description} sundial.]`);
    await h.board.createBlock(null, `Bluebell [collection::row-expansion] [description::${description} lantern.]`);
    await show('Planting instructions\n::graph-table{query="collection=row-expansion" columns="title, description" sort="title asc"}\n::', 100);
    expect(h.screen()).not.toContain("sundial.");
    expect(h.screen()).not.toContain("lantern.");
    await act("list.pick", { n: 2 });
    expect(h.screen()).toContain("lantern.");
    expect(h.screen()).not.toContain("sundial.");
    await act("list.pick", { n: 1 });
    expect(h.screen()).not.toContain("lantern.");
    expect(h.screen()).toContain("sundial.");
  }, 20_000);

  test("review1134: clicking the second visible group occurrence picks that occurrence", async () => {
    await h.board.createBlock(null, "Aster [collection::review-visible] [bed::A] [bed::B]");
    await show('Two beds\n::view{query="collection=review-visible" layout=board group=bed sort="title asc"}', 177);
    const rows = h.screen().split("\n");
    const y = rows.findIndex(line => line.indexOf("Aster") !== -1 && line.indexOf("Aster", line.indexOf("Aster") + 5) !== -1);
    expect(y).toBeGreaterThan(-1);
    const x = rows[y]!.indexOf("Aster", rows[y]!.indexOf("Aster") + 5) + 2;
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    h.screen();
    await until(() => lists()[0]?.view.picked()?.group === "/B", "the clicked B occurrence is selected", 1500);
    const selected = (await act("list.blocks")).lists[0].rows.filter((row: any) => row.selected);
    expect(selected).toMatchObject([{ n: 2, group: "/B" }]);
  }, 20_000);

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
    expect((await act("elements")).elements.find((e: any) => e.kind === "control" && e.label === "⏎ in")).toBeUndefined();
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

  test.each([{ kind: "graph-table", cols: 44 }, { kind: "view", cols: 120 }, { kind: "view", cols: 44 }])("a $kind keeps an owner's link and collection controls at $cols columns", async ({ kind, cols }) => {
    const owner = await h.board.createBlock(null, "Garden keeper\n\nThe person tending this plot.");
    const query = `collection=linked-garden-${kind}-${cols}`;
    await h.board.createBlock(null, `Tend the plot [collection::linked-garden-${kind}-${cols}] [owner::((${owner.id}))] [stage::ready]`);
    const saved = kind === "view" ? await h.board.createBlock(null, `Linked owners [type::virtual-branch] [query::${query}] [layout::table] [summary-properties::title, owner, stage]`) : null;
    await show(`Linked garden\n${saved ? `::view{of=((${saved.id}))}` : `::graph-table{query="${query}" columns="title, owner, stage"}`}\n::`, cols);
    if (kind === "view") expect(h.screen()).not.toMatch(/table.* · .*≡/);
    const keeper = (await act("elements")).elements.find((e: any) => e.label.includes(cols === 44 ? "owner:" : "Garden keeper"));
    expect(keeper).toBeDefined();
    await act("element.select", { n: keeper.n });
    expect(h.screen()).toMatch(/table.* · .*≡/);
    h.press({ kind: "enter" });
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
  test.each(["table", "board"])("PageDown moves the %s pick and lane before Enter, independently for each actor", async (layout) => {
    const flowers: { id: string }[] = [];
    for (const [title, bed] of [["Aster", "A"], ["Bluebell", "A"], ["Clover", "B"], ["Daisy", "B"]]) flowers.push(await h.board.createBlock(null, `${title} [collection::paging-${layout}] [bed::${bed}]`));
    await show(`Flowers\n::view{query="collection=paging-${layout}" layout=${layout} group=bed sort="title asc" page=2}`, 44);
    await agent("list.page", { by: 1 });
    expect((await agent("list.blocks")).lists[0].yours.picked).toBe(flowers[2]!.id);
    expect(lists()[0].view.picked().id).toBe(flowers[0]!.id);
    await agent("list.filter", { words: "title~Aster" });
    expect(await agent("list.page", { by: 1 })).toMatchObject({ page: 1, pages: 1 });
    await act("list.enter", { on: true });
    h.press({ kind: "pgdn" });
    await until(() => lists()[0].view.page === 1, "page two", 4000);
    expect(h.screen()).toContain("Clover");
    expect(lists()[0].view.picked().id).toBe(flowers[2]!.id);
    h.press({ kind: "enter" });
    await until(() => stage().pane("garden").surface.msg?.id === flowers[2]!.id, "Enter opens the page-two pick", 4000);
  }, 20_000);

  test("a narrow table's leading linked cell opens that note at the recorded revision", async () => {
    const notebook = await h.board.createBlock(null, "Flower notebook\n\nBefore the rain.");
    await h.board.request("update", { blockId: notebook.id, text: "Flower notebook\n\nAfter the rain.", expectedRevision: notebook.revision, mutation: { author: "user" } });
    await h.board.createBlock(null, `Notebook review [collection::leading-cell] [note::${notebook.id}] [revision::1] [rubric::clear]`);
    await show('Review table\n::graph-table{query="collection=leading-cell" columns="note, rubric"}\n::', 44);
    const cell = (await act("elements")).elements.find((e: any) => e.label.includes("note:"));
    expect(cell).toBeDefined();
    await act("element.open", { n: cell.n });
    await until(() => stage().pane("garden").surface.msg?.id === notebook.id, "the leading cell opens the notebook", 4000);
    await show('Review with a revision\n::graph-table{query="collection=leading-cell" columns="note, rubric" link=note at=revision}\n::', 44);
    const recorded = (await act("elements")).elements.find((e: any) => e.label.includes("note:"));
    await act("element.open", { n: recorded.n });
    const reader = () => [...stage().panes.values()].find((pane: any) => pane.surface?.msg?.id === notebook.id) as any;
    await until(() => !!reader()?.surface.revisionMode, "the recorded revision is shown", 4000);
    expect(reader().surface.revisionMode.describe()).toMatchObject({ revision: 1, to: 2 });
    h.press({ kind: "esc" });
  }, 20_000);

  test("Tab belongs to the editor opened from an entered collection", async () => {
    await show('Editing flowers\n::view{query="collection=garden" layout="table, gallery"}');
    await act("list.enter", { on: true });
    await act("edit");
    const surface = stage().pane("garden").surface;
    expect((await agent("list.blocks")).lists[0].entered).toBe(false);
    const before = surface.draft.text;
    h.press({ kind: "tab" });
    expect(surface.draft.text).not.toBe(before);
    h.press({ kind: "esc" });
    await until(() => !surface.draft, "editor closes", 4000);
    expect(lists()[0].detail.layout).toBe("table");
  }, 20_000);

  test("review: a multi-valued group still turns to page two", async () => {
    const aster = await h.board.createBlock(null, "Aster [collection::review-multi] [bed::A] [bed::B]");
    await h.board.createBlock(null, "Bluebell [collection::review-multi] [bed::B]");
    await show('Flowers in two beds\n::view{query="collection=review-multi" layout=board group=bed sort="title asc" page=1}');
    await act("list.pick", { n: 1 });
    await act("list.enter", { on: true });
    h.press({ kind: "pgdn" });
    await until(() => lists()[0]?.detail?.page === 2, "the second occurrence's page", 4000);
    const second = (await act("list.blocks")).lists[0];
    expect(second.page).toBe(2);
    expect(second.pages).toBe(3);
    expect(second.rows.filter((r: any) => r.selected)).toMatchObject([{ id: aster.id, n: 2 }]);
    expect(second.rows[1].group).not.toBe(second.rows[0].group);
    h.press({ kind: "pgdn" });
    await until(() => lists()[0]?.detail?.page === 3, "Bluebell's page", 4000);
    expect(h.screen()).toContain("Bluebell");
    expect(await act("list.step", { by: -1 })).toMatchObject({ row: 2 });
    expect(await act("list.pick", { n: 2 })).toMatchObject({ row: 2 });
    expect((await act("list.blocks")).lists[0].page).toBe(2);
    expect((await act("list.open")).opened).toBe(aster.id);
  }, 20_000);

  test("review: a linked cell opens its own target even when that target is another collection row", async () => {
    const end = await h.board.createBlock(null, "Cedar handbook");
    const middle = await h.board.createBlock(null, `Birch record [collection::review-link] [note::${end.id}]`);
    await h.board.createBlock(null, `Aster record [collection::review-link] [note::${middle.id}]`);
    await show('Linked records\n::graph-table{query="collection=review-link" columns="note" sort="title asc" link=note width=full}\n::');
    const cells = (await act("elements")).elements;
    const cell = cells.find((e: any) => e.label.trim() === "Birch record");
    expect(cell).toBeDefined();
    expect(stage().layoutGet().tiles.some((t: any) => t.showing?.id === middle.id)).toBe(false);
    const drawn = h.screen().split("\n"), y = drawn.findIndex(line => line.includes("Birch record")), x = drawn[y]!.indexOf("Birch record") + 2;
    const click = () => {
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
    };
    click();
    expect((await act("elements")).elements.find((e: any) => e.current)?.label).toBe("Birch record");
    h.screen(); click();
    await until(() => stage().layoutGet().tiles.some((t: any) => t.showing?.id === middle.id), "the full-width cell opens its target");
  }, 20_000);

  test("review: sorting after a page change keeps the selected note on the drawn page", async () => {
    for (const title of ["Aster", "Bluebell", "Clover", "Daisy"]) await h.board.createBlock(null, `${title} [collection::review-sort]`);
    await show('Sorted flowers\n::view{query="collection=review-sort" layout=table sort="title asc" page=2}', 44);
    await act("list.pick", { n: 3 });
    expect(h.screen()).toContain("Clover");
    await agent("list.pick", { n: 3 });
    await agent("list.sort", { by: "title", order: "desc" });
    expect((await agent("list.page", { by: 0 })).page).toBe(1);
    expect((await act("list.blocks")).lists[0].page).toBe(2);
    expect(lists()[0].view.picked().label).toBe("Clover");
    await act("list.sort", { by: "title", order: "desc" });
    await until(() => lists()[0]?.detail?.sort === "title desc", "descending answer", 4000);
    const drawn = h.screen(), picked = lists()[0].view.picked();
    const opened = await act("list.open");
    expect(opened.opened).toBe(picked.id);
    expect(drawn).toContain(picked.label);
  }, 20_000);

  test.each(["this", "inbox"])("review: the board creates under the same create-parent %s as Tree", async parent => {
    const { boardScreen, view } = await import("../board-view");
    const hub = await h.board.createBlock(null, "Flower work");
    const inbox = await h.board.request<{ blocks: { id: string }[] }>("blocks.query", { query: { filters: [{ key: "system-view", value: "inbox" }] } });
    await h.board.createBlock(hub.id, `Flowers [type::virtual-branch] [query::kind=review-flower] [create::kind=review-flower] [create-parent::${parent}]`);
    await h.board.createBlock(hub.id, `Pots [type::virtual-branch] [query::kind=review-pot] [create-parent::${hub.id}]`);
    const board = boardScreen(hub.id, false);
    h.app.push(board);
    await until(() => { board.render(h.app); return view(board).lanes.length === 2 && view(board).lanes.every(lane => lane.items); }, "the two flower lanes", 8000);
    const created = await board.dispatch.act({ action: "card.create", args: { lane: "Flowers", text: "Aster" } }, { kind: "user" }) as any;
    const expected = parent === "this" ? hub.id : inbox.blocks[0]!.id;
    expect(created.parent).toBe(expected);
    expect((await h.board.get(created.id))?.parentId).toBe(expected);
  }, 20_000);

});
