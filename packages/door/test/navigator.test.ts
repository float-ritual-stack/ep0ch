// PIE-1443: the navigator. The facets tile's Matches is a list grouped by the service (Pinned, then Today, Yesterday,
// Previous 7 days, months), each row its excerpt and chips; it is the tile's attachment (inline, split, floating, popup
// or a tile of its own, as Sources and comments are); a row is pinned, tagged or opened beside by one action; a day on
// the calendar and a saved view set the selection. `--screen navigator` holds the tree, the Matches tile and a reader,
// wired. A scratch outline of made-up notes; every step through `act`, the person's keys and clicks.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

describe.skipIf(!outliner)("the navigator, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  const AS = "navigator-agent-1443";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile = "facets") => app.act({ action, args, tile, as: AS }) as Promise<any>;
  const pane = (name: string) => D().describe().panes.find((p: any) => p.name === name);
  const tile = () => pane("facets");
  const groups = () => (tile().matches?.groups ?? []).map((g: any) => `${g.label}:${g.notes.map((n: any) => n.title).join(",")}`);
  let seed: string, trellis: string, view: string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const make = async (text: string) => (await board.request<any>("create", { parentId: null, text, author: "agent" })).id as string;
    trellis = await make("Pea trellis [plot::beds] #garden\nNetting arrives **Thursday**; posts first.");
    seed = await make("Seed order [plot::beds] #garden\nForty packets of sugar snap.");
    await make("Shed roof [plot::shed]\nA quote for the felt.");
    view = await make("Bed notes [type::virtual-branch] [query::plot=beds]");
    const term = { info: { cols: 177, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(_: (k: Key) => void) {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    desk.render(D().ctx);
    expect(await act("tile.open", { kind: "facets", name: "facets", where: "right" }, "1")).toMatchObject({ name: "facets" });
    await until(() => tile()?.matches?.groups?.length > 0, "the facets tile's matches");
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("Matches is grouped by the service, newest first, each row with its excerpt and chips; a pinned note comes first", async () => {
    await act("facets.query", { text: "plot=beds" });
    // Newest first: the seed order was written last.
    expect(groups()).toEqual(["Today:Seed order,Pea trellis"]);
    const row = tile().matches.groups[0].notes.find((n: any) => n.title === "Pea trellis");
    expect(row).toMatchObject({ excerpt: "Netting arrives Thursday; posts first.", chips: ["#garden"] });
    // A pin never edits the note it pins (PIE-1448): only the pins page changes.
    const before = (await board.get(trellis))!.revision;
    expect(await act("facets.pin", { id: trellis })).toMatchObject({ id: trellis, pinned: true });
    await until(() => groups()[0] === "Pinned:Pea trellis", "the pinned note first");
    expect(groups()).toEqual(["Pinned:Pea trellis", "Today:Seed order"]);
    expect((await board.get(trellis))!.revision).toBe(before);
    const pins = await board.resolvePage("pins");
    expect(pins.block && (await board.get(pins.block.id))!.text).toContain(trellis);
    expect(await act("facets.pin", { id: trellis })).toMatchObject({ pinned: false });
    await until(() => groups().length === 1, "unpinned");
    expect((await board.get(trellis))!.revision).toBe(before);
  }, 20_000);

  test("every group can be reached: past the first page a group says how many more, and reading it lists them all (PIE-1448)", async () => {
    // 205 made-up notes from the last two days: the first page holds 200.
    for (let i = 0; i < 205; i++) await board.request<any>("create", { parentId: null, text: `Seedling ${i} [tray::bulk]`, author: "agent" });
    await act("facets.query", { text: "tray=bulk" });
    await until(() => tile().matched === 205, "the bulk notes");
    const today = () => tile().matches.groups.find((g: any) => g.label === "Today");
    expect(today()).toMatchObject({ count: 205, more: 5 });
    expect(await act("facets.more", { group: "Today" })).toMatchObject({ group: "Today", notes: 205 });
    expect(today()).toMatchObject({ count: 205, more: 0 });
    expect(today().notes.length).toBe(205);
  }, 60_000);

  test("saving the pick as a view: a pick already saved is refused with that view's name", async () => {
    await act("facets.query", { text: "plot=beds" });
    await expect(act("facets.save", { name: "Beds again" })).rejects.toThrow(/already the view "Bed notes"/);
  }, 20_000);

  test("a row takes a tag or any property by one action, written to the note as the person would", async () => {
    expect(await act("facets.tag", { id: seed, key: "stage", value: "next" })).toMatchObject({ id: seed, key: "stage", value: "next" });
    expect(await act("facets.tag", { id: seed, value: "#urgent" })).toMatchObject({ key: "tag", value: "urgent" });
    const note = (await board.get(seed))!;
    expect(note.text).toContain("[stage::next]");
    expect(note.properties).toEqual(expect.arrayContaining([{ key: "tag", value: "urgent" }]));
  }, 20_000);

  test("a day on the calendar narrows the selection, and Matches follows; a saved view sets the selection", async () => {
    const today = new Date(), iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(await act("facets.day", { day: iso })).toMatchObject({ day: iso });
    expect(tile().query).toContain(`updated >= "${today.getDate()} `);
    expect(tile().matched).toBeGreaterThan(0);
    expect(await act("facets.day", { day: "2001-01-01" })).toMatchObject({ day: "2001-01-01" });
    await until(() => tile().matched === 0, "nothing that day");
    await act("facets.day", { day: "" });
    expect(tile().query).not.toContain("updated >=");
    // 0 and backspace on the day's row drop it, as they drop any pick.
    await act("facets.day", { day: iso });
    const p = D().panes.get([...D().panes].find(([, x]: any) => x.kind === "facets")![0]);
    p.at = p.rows().findIndex((r: any) => r.kind === "day");
    p.key({ kind: "char", ch: "0" }, D());
    await until(() => !tile().query.includes("updated >="), "the day dropped by 0");
    expect(tile().views.map((v: any) => v.title)).toContain("Bed notes");
    expect(await act("facets.view", { id: view })).toMatchObject({ query: "plot=beds" });
    expect(groups()[0]).toMatch(/^Today:/);
  }, 20_000);

  test("Matches is an attachment: split, floating, popup, and a tile of its own that goes away when it comes back inline", async () => {
    for (const place of ["split", "floating", "popup"]) expect(await act("facets.place", { place })).toMatchObject({ place });
    expect(await act("facets.place", { place: "tile" })).toMatchObject({ place: "tile" });
    await until(() => !!D().describe().panes.find((p: any) => p.kind === "matches"), "the matches tile");
    const m = D().describe().panes.find((p: any) => p.kind === "matches");
    expect(m.source).toBe("tile:facets");
    expect(await act("facets.place", { place: "inline" })).toMatchObject({ place: "inline" });
    await until(() => !D().describe().panes.find((p: any) => p.kind === "matches"), "the matches tile closed");
  }, 20_000);

  test("--screen navigator opens the tree, its Matches as a tile and a reader, the Matches wired to the reader", async () => {
    const screen = openScreen("navigator") as any;
    app.push(screen);
    screen.render(D().ctx);
    const layout = screen.layoutGet();
    expect(layout.tiles.map((t: any) => t.kind)).toEqual(expect.arrayContaining(["facets", "matches", "reader"]));
    const matches = layout.tiles.find((t: any) => t.kind === "matches");
    expect(matches.wires?.find((w: any) => w.verb === "select")).toBeTruthy();
  }, 20_000);
});
