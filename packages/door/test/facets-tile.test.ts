// PIE-881: the facets tile lists the properties the notes have, each opening to its values with uses and last use; values are
// included or excluded (ORed in a facet, ANDed across them), path values are a tree, and the selection is the views' query
// grammar, typed or saved as a view. The service counts all of it. A scratch outline of made-up notes; every step through
// `act` and the person's keys and clicks.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { selectionQuery } from "../src/desk/facets";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import { prop } from "../src/props";

const char = (ch: string): Key => ({ kind: "char", ch });

test("the selection is written in the views' grammar: a facet's included values ORed, facets ANDed, an exclusion a NOT, a path with /*, a tag as #tag", () => {
  expect(selectionQuery([
    { key: "plot", value: "x/y", mode: "include", path: true }, { key: "job", value: "meeting", mode: "include" },
    { key: "tag", value: "yomama", mode: "include" }, { key: "tag", value: "needs-attention", mode: "include" },
    { key: "week", value: "3", mode: "exclude" }, { key: "week", value: "5", mode: "exclude" }, { key: "area", value: "back garden", mode: "include" },
  ], "")).toBe('plot=x/y/* job=meeting (#yomama OR #needs-attention) NOT week=3 NOT week=5 area="back garden"');
  expect(selectionQuery([{ key: "job", value: "task", mode: "include" }], "#a OR #b")).toBe("(#a OR #b) job=task");
  // A value is written exactly: quoted and escaped when it needs it, with a path's /* inside the quotes.
  expect(selectionQuery([{ key: "label", value: 'ACME "West"', mode: "include" }, { key: "area", value: "back garden", mode: "exclude", path: true }, { key: "label", value: "#important", mode: "include" }], ""))
    .toBe('(label="ACME \\"West\\"" OR label="#important") NOT area="back garden/*"');
});

describe.skipIf(!outliner)("the facets tile, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "facets-agent-881";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile = "facets") => app.act({ action, args, tile, as: AS }) as Promise<any>;
  const tile = () => D().describe().panes.find((p: any) => p.name === "facets");
  const facet = (name: string) => (tile().facets as any[]).find(f => f.key === name);
  const values = (name: string) => (facet(name)?.values ?? []).map((v: any) => `${v.value}${v.uses === null ? "" : ":" + v.uses}${v.state ? v.state === "include" ? "+" : "-" : ""}`);
  const titles = () => (tile().notes as any[]).map(n => n.title.replace(/ #.*$/, "")).sort();

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const make = (text: string) => board.request<any>("create", { parentId: null, text, author: "agent" });
    await make("Standup [job::meeting] [plot::garden/beds] [week::3] #yomama #needs-attention");
    await make("Retro [job::meeting] [plot::garden/paths] [week::5] #yomama");
    await make("Shed audit [job::task] [plot::house/shed] [week::9] #isfine #yomama");
    await make("Fence plan [job::task] [plot::garden/beds/fence] [week::4] #needs-attention");
    const term = { info: { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    desk.render(D().ctx);
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("it lists the properties the notes have, each with its notes; a facet opens to its values with uses; path values are a tree; a tag is a facet like the others", async () => {
    expect(await act("tile.open", { kind: "facets", name: "facets", where: "right" }, "1")).toMatchObject({ name: "facets", kind: "facets" });
    await until(() => !!facet("plot"), "the facets");
    expect(["plot", "tag", "job", "week"].every(k => facet(k))).toBe(true);
    expect(facet("job")).toMatchObject({ notes: 4, open: false, values: [] });
    await act("facets.fold", { key: "job" });
    await act("facets.fold", { key: "tag" });
    await act("facets.fold", { key: "plot" });
    expect(values("job").sort()).toEqual(["meeting:2", "task:2"]);
    expect(values("tag").sort()).toEqual(["isfine:1", "needs-attention:2", "yomama:3"]);
    // plot=garden is no value a note carries, only a node holding garden/beds, garden/beds/fence and garden/paths.
    expect(values("plot")).toEqual(expect.arrayContaining(["garden", "garden/beds:1", "garden/beds/fence:1", "garden/paths:1", "house", "house/shed:1"]));
  }, 20_000);

  test("included values AND across facets and OR within one; an excluded value is a NOT; a path includes what is below it; picking again steps include → exclude → off", async () => {
    // The path is known from the answer, so it is the same with the facet folded.
    await act("facets.fold", { key: "plot" });
    expect(await act("facets.set", { key: "plot", value: "garden", mode: "include" })).toMatchObject({ query: "plot=garden/*" });
    expect(await act("facets.set", { key: "plot", value: "garden", mode: "exclude" })).toMatchObject({ query: "NOT plot=garden/*" });
    await act("facets.clear");
    await act("facets.fold", { key: "plot" });
    // Picking the garden node includes everything below it.
    expect(await act("facets.set", { key: "plot", value: "garden" })).toMatchObject({ mode: "include", query: "plot=garden/*", notes: 3 });
    expect(titles()).toEqual(["Fence plan", "Retro", "Standup"]);
    // Across facets: ANDed. Within one: ORed.
    await act("facets.set", { key: "job", value: "meeting" });
    expect(titles()).toEqual(["Retro", "Standup"]);
    await act("facets.set", { key: "tag", value: "needs-attention" });
    await act("facets.set", { key: "tag", value: "yomama" });
    expect(tile().query).toBe("plot=garden/* job=meeting (#needs-attention OR #yomama)");
    expect(titles()).toEqual(["Retro", "Standup"]);
    // Excluded: week 3 goes; only the retro is left. The counts are inside the selection.
    await act("facets.set", { key: "week", value: "3", mode: "exclude" });
    expect(titles()).toEqual(["Retro"]);
    expect(tile().query).toContain("NOT week=3");
    // A second pick of an included value excludes it, a third drops it.
    expect(await act("facets.set", { key: "job", value: "meeting" })).toMatchObject({ mode: "exclude" });
    expect(titles()).toEqual(["Fence plan"]);
    expect(await act("facets.set", { key: "job", value: "meeting" })).toMatchObject({ mode: "off" });
    expect(titles()).toEqual(["Fence plan", "Retro"]);
    await act("facets.clear");
    expect(tile().query).toBe("");
    expect(titles()).toEqual(expect.arrayContaining(["Fence plan", "Retro", "Shed audit", "Standup"]));
  }, 20_000);

  test("the selection is text: typed with e (⏎ applies, esc undoes) or set by facets.query; a query the service refuses keeps the selection; saved as a view in one action", async () => {
    D().focusTile("facets", { kind: "person" } as any);
    key(char("e"));
    expect(tile().typing).toBe("");
    for (const c of "plot=garden/* NOT week=5") key(char(c));
    key({ kind: "enter" });
    await until(() => tile().query === "plot=garden/* NOT week=5" && titles().length === 2, "the typed query");
    expect(titles()).toEqual(["Fence plan", "Standup"]);
    key(char("e")); key(char("x")); key({ kind: "esc" });
    expect(tile().query).toBe("plot=garden/* NOT week=5");
    await expect(act("facets.query", { text: "NOT" })).rejects.toThrow(/wasn't answered/);
    expect(tile().query).toBe("plot=garden/* NOT week=5");
    // One action makes it a view: a virtual-branch holding the query, which the service reads back as the same notes.
    const saved = await act("facets.save", { name: "Garden, not week 5" });
    expect(saved).toMatchObject({ title: "Garden, not week 5", query: "plot=garden/* NOT week=5" });
    const view = await board.get(saved.id);
    expect(prop(view!, "type")).toBe("virtual-branch");
    expect(prop(view!, "query")).toBe("plot=garden/* NOT week=5");
    await expect(act("facets.save")).resolves.toBeTruthy();
    await act("facets.clear");
    await expect(act("facets.save")).rejects.toThrow(/nothing is selected/);
  }, 20_000);

  test("a note the selection leaves opens as ⏎ opens one in any list; a click on a value includes it, alt-click excludes; a new note is counted when the outline changes", async () => {
    await act("facets.query", { text: "#yomama" });
    const note = (tile().notes as any[]).find(n => /Retro/.test(n.title));
    expect(await act("facets.open", { id: note.id })).toMatchObject({ id: note.id });
    expect(D().layoutGet().tiles.some((t: any) => t.showing?.id === note.id)).toBe(true);
    await board.request<any>("create", { parentId: null, text: "Compost audit [job::task] #yomama", author: "agent" });
    await until(() => tile().notes.length === 4, "the new note under #yomama");
    await act("facets.clear");
  }, 20_000);

  test("the tags tile is this one opened on the tags facet", async () => {
    expect(await act("tile.open", { kind: "tags", name: "tags", where: "right" }, "1")).toMatchObject({ name: "tags", kind: "tags" });
    const t = () => D().describe().panes.find((p: any) => p.name === "tags");
    await until(() => t()?.facets?.length > 0, "the tags tile's facets");
    expect(t().facets.find((f: any) => f.key === "tag")).toMatchObject({ open: true });
    expect(t().facets.find((f: any) => f.key === "plot")).toMatchObject({ open: false });
  }, 20_000);
});
