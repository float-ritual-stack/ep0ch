// PIE-1513: a live ::graph-table's ≡ settings are its own keys, written into its YAML; layout: feed draws through the
// views' renderer and sticks across a reopen; ctrl+z takes one write back; a key the table doesn't take is said.
import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { until } from "../scratch";

const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};
import { useShowcaseScreen } from "./harness";

describe("showcase: a live table's settings stick, and it can switch to a feed (PIE-1513)", () => {
  const h = useShowcaseScreen(120);
  const stage = () => { h.screen(); return h.S().stage(SECTIONS.findIndex(s => s.key === "figure-settings")).top; };
  const act = (action: string, args: Record<string, unknown> = {}, actor: { kind: "user" } | { kind: "agent"; id: string } = { kind: "user" }) => stage().dispatch.act({ action, tile: "sprint", args }, actor) as Promise<any>;
  const surface = () => stage().pane("sprint").surface;
  const lists = () => { h.screen(); return surface().listsDrawn as any[]; };
  const note = () => h.seeded.notes.figureSettings;
  const text = async () => (await h.board.get(note().id))!.text;
  const show = async () => {
    if (h.app.bar) await h.app.dispatch.act({ action: "bar.close" }, { kind: "user" });
    await h.app.dispatch.act({ action: "section.try", args: { name: "figure-settings" } }, { kind: "user" });
    await act("tile.focus");
    if (surface().panel) await act("props.close");
    await act("open", { id: note().id });
    await until(() => lists().some(l => l.key === "^sprint" && l.detail?.layout), "the live table drew", 10_000);
  };

  test("the card offers the table's own keys, and layout feed lands in the YAML, redraws, undoes and sticks", async () => {
    await show();
    const settings = await act("settings", { list: "^sprint" });
    expect(settings.schema).toBe("graph-table");
    const keys = settings.fields.map((f: any) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["title", "query", "columns", "sort", "layout"]));
    expect(keys).not.toContain("summary-properties");
    expect(keys).not.toContain("card");
    expect(settings.fields.find((f: any) => f.key === "columns").value).toBe("title, owner, stage");
    expect(settings.fields.find((f: any) => f.key === "layout").value).toBeNull();
    expect(h.screen()).toContain("settings · Table (::graph-table)");

    const before = await text();
    const r = await act("settings.set", { key: "layout", value: "feed" });
    expect(r.saved).toBe(true);
    const after = await text();
    expect(after).toContain('layout: "feed"');
    expect(after.replace('layout: "feed"\n', "")).toBe(before);
    await until(() => lists().find(l => l.key === "^sprint")?.detail.layout === "feed", "the table redraws as a feed", 10_000);
    expect(lists().find(l => l.key === "^sprint").detail.layouts).toEqual(["feed"]);

    // ctrl+z with the card open puts the write back; so does the reader's ctrl+z once the card is closed.
    h.press({ kind: "char", ch: "z", ctrl: true });
    await untilAsync(async () => (await text()) === before, "ctrl+z put the YAML back");
    await until(() => lists().find(l => l.key === "^sprint")?.detail.layout === "table", "a table again", 10_000);

    await act("settings.set", { key: "layout", value: "feed" });
    await untilAsync(async () => (await text()).includes('layout: "feed"'), "feed written again");
    await act("props.close");
    h.press({ kind: "char", ch: "z", ctrl: true });
    await untilAsync(async () => (await text()) === before, "the reader's ctrl+z put the YAML back");
    await act("settings.set", { key: "layout", value: "feed", list: "^sprint" });
    await untilAsync(async () => (await text()).includes('layout: "feed"'), "feed written a third time");
    // Reopen: the choice is in the block, so it is still a feed.
    await act("open", { id: h.seeded.notes.collectionTune.id });
    await act("open", { id: note().id });
    await until(() => lists().find(l => l.key === "^sprint")?.detail.layout === "feed", "still a feed after reopening", 10_000);
    await expect(act("settings.set", { key: "layout", value: "cards" })).rejects.toThrow(/layout .*is one of table, feed, gallery, board/);
    await expect(act("settings.set", { key: "card", value: "large" })).rejects.toThrow(/has no field card/);
  }, 40_000);

  test("a figure written with attributes shows them as set, and toggling a column keeps the others (PIE-1513 review)", async () => {
    await show();
    const now = (await h.board.get(note().id))!;
    const attrs = now.text.replace(/::graph-table \^sprint\n---\n[\s\S]*?\n---\n::/, '::graph-table{query="collection=garden" columns="title, owner" layout=feed} ^sprint\n::');
    expect(attrs).not.toBe(now.text);
    await h.board.update(now.id, attrs, now.revision!, { kind: "user" });
    await until(() => surface().msg?.text.includes('layout=feed') ?? false, "the attribute form arrived");
    const settings = await act("settings", { list: "^sprint" });
    const value = (key: string) => settings.fields.find((f: any) => f.key === key).value;
    expect(value("query")).toBe("collection=garden");
    expect(value("columns")).toBe("title, owner");
    expect(value("layout")).toBe("feed");
    await act("settings.toggle", { key: "columns", value: "stage" });
    expect(await text()).toContain('columns="title, owner, stage"');
    expect((await act("settings.set", { key: "titlecolumn", value: "1" })).saved).toBe(true);
    expect(await text()).toContain('titleColumn="1"');
    // Put the seeded YAML form back for the next test.
    const back = (await h.board.get(note().id))!;
    await h.board.update(back.id, now.text, back.revision!, { kind: "user" });
  }, 40_000);

  test("an agent writes a column choice without taking the keys, attributed; a key the table doesn't take is said under it", async () => {
    await show();
    await act("settings.toggle", { key: "columns", value: "owner" }, { kind: "agent", id: "gardener" });
    expect(await text()).toContain('columns: "title, stage"');
    expect(surface().panel?.card).toBeFalsy();
    await until(() => h.screen().includes("gardener"), "the agent's write is said on screen");
    const now = (await h.board.get(note().id))!;
    await h.board.update(now.id, now.text.replace("sort: title", "sort: title\nlayot: feed"), now.revision!, { kind: "user" });
    await until(() => h.screen().includes("doesn't take layot: did you mean layout?"), "the reader says the unknown key", 10_000);
  }, 40_000);
});
