import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: collection peeks (PIE-849)", () => {
  const h = useShowcaseScreen(177);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "peek")).top; };
  const act = (action: string, args: Record<string, unknown> = {}, tile = "garden") => stage().dispatch.act({ action, tile, args }, { kind: "user" }) as Promise<any>;
  const agent = (action: string, args: Record<string, unknown> = {}) => stage().dispatch.act({ action, tile: "garden", args }, { kind: "agent", id: "gardener" }) as Promise<any>;
  const list = () => stage().pane("garden").surface.listsDrawn[0];
  const floats = () => stage().layoutGet().tiles.filter((t: any) => t.float);
  const setup = async () => {
    (h.app as any).term.info.cols = 177;
    await h.app.dispatch.act({ action: "section.try", args: { name: "peek" } }, { kind: "user" });
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await act("tile.close", {}, tile.name);
    await act("tile.focus");
    await act("open", { id: h.seeded.notes.collection.id });
    await act("open", { id: h.seeded.notes.peek.id });
    for (const tile of stage().layoutGet().tiles) if (tile.name !== "garden") await act("tile.close", {}, tile.name);
    await until(() => list()?.view.pickable().length === 4, "garden cards", 8000);
  };

  test("one pick creates a follower without taking keys, and Enter enters that same peek", async () => {
    await setup();
    const lines = h.screen().split("\n"), label = list().view.pickable()[0].label;
    const y = lines.findIndex(line => line.includes(label)), x = lines[y]!.indexOf(label) + 2;
    h.press({ kind: "mouse", action: "down", button: 0, x, y });
    h.press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => floats().length === 1, "a picked card's float", 1500);
    const peek = floats()[0].name;
    expect(stage().focusedName()).toBe("garden");
    h.ch("j");
    await until(() => list().view.picked().id === list().view.pickable()[2].id, "j reaches the next page's column", 1500);
    await until(() => floats()[0]?.showing?.id === list().view.picked().id, "the float follows", 1500);
    expect(floats()).toHaveLength(1);
    expect(floats()[0].name).toBe(peek);
    h.press({ kind: "enter" });
    await until(() => stage().focusedName() === peek, "Enter gives the peek the keys", 1500);
    expect(floats()).toHaveLength(1);
    expect(stage().pane("garden").surface.msg.id).toBe(h.seeded.notes.peek.id);
  }, 15_000);

  test("Esc closes the entered peek and returns keys to its gallery", async () => {
    await setup();
    await act("list.open", { n: 2 });
    expect(floats()).toHaveLength(1);
    h.press({ kind: "esc" });
    await until(() => floats().length === 0, "Esc closes the peek", 1500);
    expect(stage().focusedName()).toBe("garden");
  }, 15_000);

  test("a peek lands to the right of its source and keeps its note after another pick", async () => {
    await setup();
    await act("list.open", { n: 2 });
    const peek = floats()[0], kept = peek.showing.id;
    await act("tile.float", { on: false, where: "right" }, peek.name);
    const layout = stage().layoutGet();
    expect(floats()).toHaveLength(0);
    expect(layout.tree.split).toBe("row");
    expect(layout.tree.kids.map((t: any) => t.name)).toEqual(["garden", peek.name]);
    expect(layout.tiles.find((t: any) => t.name === peek.name).rect.col).toBeGreaterThan(layout.tiles.find((t: any) => t.name === "garden").rect.col);
    await act("tile.focus");
    await act("list.pick", { n: 1 });
    await until(() => floats().length === 1, "a fresh peek after landing", 1500);
    expect(stage().pane(peek.name).surface.msg.id).toBe(kept);
  }, 15_000);

  test("clickable pages are each actor's reading state and never edit the saved view", async () => {
    await setup();
    const before = await h.board.get(h.seeded.notes.peek.id);
    await agent("list.page", { by: 1 });
    expect((await act("list.blocks")).lists[0].page).toBe(1);
    expect((await agent("list.blocks")).lists[0].yours.page).toBe(2);
    expect(floats()).toHaveLength(0);
    expect(stage().focusedName()).toBe("garden");
    expect(h.screen()).toContain("gardener: page 2/2");
    const next = (await act("elements")).elements.find((e: any) => e.label === "▶");
    expect(next).toBeDefined();
    await act("button.press", { n: next.n });
    expect((await act("list.blocks")).lists[0].page).toBe(2);
    expect(h.screen()).toContain("2/2");
    await until(() => floats()[0]?.showing?.id === list().view.picked().id, "page previews its first card", 1500);
    const after = await h.board.get(h.seeded.notes.peek.id);
    expect(after?.revision).toBe(before?.revision);
    expect(after?.text).toBe(before?.text);
  }, 15_000);

  test("h l step across gallery columns and board lanes; H L step across groups", async () => {
    await setup();
    await act("list.enter", { on: true });
    await act("list.pick", { n: 1 });
    h.ch("l");
    await until(() => list().view.picked().id === list().view.pickable()[1].id, "l crosses a column", 1500);
    h.ch("h");
    await until(() => list().view.picked().id === list().view.pickable()[0].id, "h returns a column", 1500);
    await act("list.layout", { layout: "board" });
    await until(() => list().detail.layout === "board", "board lanes", 4000);
    await act("list.pick", { n: 1 });
    const first = list().view.picked().group;
    h.ch("l");
    await until(() => list().view.picked().group !== first, "l crosses a lane", 1500);
    h.ch("H");
    await until(() => list().view.picked().group === first, "H returns a group", 1500);
    await agent("list.step", { by: 1, axis: "group" });
    expect(list().view.picked().group).toBe(first);
  }, 20_000);

  test("container float and full rules apply after a tile's wire", async () => {
    await setup();
    const note = await h.board.createBlock(null, "Plain garden\n::view{query=collection=garden layout=gallery} ^plain");
    await act("open", { id: note.id });
    await until(() => list()?.key === "^plain", "plain collection", 4000);
    await act("layout.policy", { node: "screen", opens: "float" });
    await act("list.open", { n: 1 });
    expect(floats()).toHaveLength(1);
    await act("tile.close", {}, floats()[0].name);
    await act("layout.policy", { node: "screen", opens: "full" });
    const opened = list().view.pickable()[0].id;
    await act("list.open", { n: 1 });
    expect(stage().pane("garden").surface.msg.id).toBe(opened);
    expect(stage().layoutGet().zoom).toBe("garden");
    await act("tile.zoom", { on: false });
    await act("open", { id: note.id });
    await until(() => list()?.key === "^plain", "plain collection again", 4000);
    await act("tile.open", { kind: "reader", name: "wired" });
    await act("tile.link", { to: "wired", verb: "open" });
    await act("list.open", { n: 2 });
    expect(floats()).toHaveLength(0);
    expect(stage().pane("wired").surface.msg.id).toBe(list().view.pickable()[1].id);
  }, 15_000);
});
