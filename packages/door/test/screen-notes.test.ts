// PIE-565: screens people make. A blank screen to build from, its rows each an action; the screen saved as a screen note
// in the outline (`[type::screen]`, its spec as data), read back by every door on the outline and opened by name;
// saved again with a revision check; a built-in's name and a name two notes share refused; deleted to the Trash. And
// the empty tiles that say what they're for. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { forgetScreenNotes, loadScreenNotes, readScreenNote, screenNote, screenNoteProblems, screenNoteText } from "../src/desk/screen-notes";
import { builtinScreen, madeScreen, readSpec, screenNames } from "../src/desk/screen-spec";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

test("a screen note's text holds its spec as data, read back as the same spec under the note's name", () => {
  const spec = readSpec({ name: "potting", title: "potting", layouts: true, layout: { focus: "tree", root: { t: "leaf", kind: "tree", name: "tree" } } });
  const text = screenNoteText(spec);
  expect(text.split("\n")[0]).toBe("potting [type::screen] [screen::potting]");
  const read = readScreenNote({ id: "n1", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: { type: "screen", screen: "potting" }, revision: 3 });
  expect(read).toMatchObject({ name: "potting", id: "n1", revision: 3, spec });
  // Renamed by its property, it's that screen; a note without its fence says how to write one.
  expect(readScreenNote({ id: "n1", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: { type: "screen", screen: "seedlings" }, revision: 3 })).toMatchObject({ name: "seedlings", spec: { name: "seedlings", title: "seedlings" } });
  expect(readScreenNote({ id: "n2", text: "bare [type::screen]", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: { type: "screen" } })).toMatchObject({ problem: expect.stringContaining("has no ```json fence") });
});

describe.skipIf(!outliner)("screens people make, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const info = { cols: 180, rows: 44, cellW: 9, cellH: 16, kitty: false };
  const AS = "screen-maker-565";
  const top = () => app.screens().at(-1) as Desk & Record<string, any>;
  const render = () => top().render((top() as any).ctx);
  const get = () => top().layoutGet() as { tiles: any[]; layout: string | null };
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => top().dispatch.act({ action, args, tile }, { kind: "user" });
  const agent = (action: string, args: Record<string, unknown> = {}, tile?: string) => app.act({ action, args, tile, as: AS });
  const notes: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = `${scratch.root}/door`;
    board = new SocketBoard(await scratch.start());
    await board.info();
    notes.beds = await board.request<any>("create", { parentId: null, text: "Raised beds\nCompost goes in first.", author: "user" });
    notes.view = await board.request<any>("create", { parentId: null, text: "Sowing list [type::virtual-branch] [query::type=sowing]", author: "user" });
    const term = { info, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    forgetScreenNotes();
    await app.loadScreens();
  }, 30_000);
  afterAll(async () => { for (const s of app?.screens() ?? []) (s as any).dispose?.(); forgetScreenNotes(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("M on the menu opens a blank screen: one tile whose rows say what each first step is, each a key and a click", async () => {
    key({ kind: "char", ch: "M" });
    await until(() => top()?.name === "blank", "the blank screen");
    render();
    const lines = top().render((top() as any).ctx).lines.join("\n");
    expect(lines).toContain("A blank screen. Start it with a tile here:");
    for (const row of ["t  the outline", "r  a reader", "d  a detail", "s  a terminal", "Q  a query lane", "o  open a screen…"]) expect(lines.replace(/\x1b\[[\d;]*m/g, "")).toContain(row);
    // Its ⋯ menu has the same rows, as the dispatcher lists them (an agent's answers them; the person's opens it).
    const menu = await agent("tile.menu", {}, "blank") as any;
    expect(menu.rows.filter((r: any) => r.group === "Start").map((r: any) => r.label)).toEqual(["the outline", "a reader", "a detail", "a terminal", "a query lane", "open a screen…"]);
    expect(menu.rows.map((r: any) => r.label)).toContain("save this screen as…");
    // A click on the outline's row is its key: the outline takes the blank tile's place, the keys with it.
    const r = get().tiles.find(t => t.name === "blank").rect;
    key({ kind: "mouse", action: "down", button: 0, x: r.col + 3, y: r.row + 3 }); key({ kind: "mouse", action: "up", button: 0, x: r.col + 3, y: r.row + 3 });
    await until(() => get().tiles.some(t => t.kind === "tree"), "the outline in its place");
    expect(get().tiles.map(t => t.kind)).toEqual(["tree"]);
  });

  test("the person builds it with the desk's own actions, saves it, and it's a screen note in the outline", async () => {
    await mine("tile.open", { kind: "detail", where: "right" }, "tree");
    await mine("tile.link", { to: "detail" }, "tree");
    // The leaving question: built and not saved.
    expect(top().shapeWarning()).toContain("has changes not saved");
    const saved = await mine("screen.save", { name: "potting" }) as any;
    expect(saved).toMatchObject({ screen: "potting", created: true, tiles: ["tree", "detail"] });
    expect(top().title).toBe("potting");
    expect(top().name).toBe("potting");
    expect(top().shapeWarning()).toBeNull();
    const note = await board.get(saved.note);
    expect(note!.props).toMatchObject({ type: "screen", screen: "potting" });
    expect(note!.text).toContain("```json");
    expect(madeScreen("potting")).toMatchObject({ id: saved.note });
    // A built-in's name is refused, saying why.
    await expect(mine("screen.save", { name: "desk" })).rejects.toThrow(/desk is a built-in screen/);
    expect(builtinScreen("blank")).toBe(true);
  });

  test("another door reads it: registered by name, in screen.list, opened by screen.open as it was saved", async () => {
    forgetScreenNotes();
    expect(screenNames()).not.toContain("potting");
    const r = await loadScreenNotes(board);
    expect(r.added).toContain("potting");
    const list = await app.dispatch.act({ action: "screen.list" }, { kind: "user" }) as any;
    expect(list.named.find((n: any) => n.name === "potting")).toMatchObject({ made: true });
    await app.dispatch.act({ action: "screen.open", args: { name: "potting" } }, { kind: "user" });
    await until(() => top().name === "potting" && top() !== undefined, "potting opened");
    expect(get().tiles.map(t => t.name)).toEqual(["tree", "detail"]);
    expect(get().layout).toBe("potting");
    // The tree's opens land in the detail, as it was linked.
    expect(get().tiles.find(t => t.name === "tree").link).toBe("detail");
  });

  test("saved again it's the same note at the next revision; a note changed since is refused, read again, then written", async () => {
    const before = madeScreen("potting")!;
    await mine("tile.preview", { where: "down" }, "detail");
    const again = await mine("screen.save", { name: "potting" }) as any;
    expect(again).toMatchObject({ created: false, note: before.id });
    expect(again.revision).toBeGreaterThan(before.revision);
    // Another client edits the note, and this door reads it again (the change feed): the screen shown was opened from
    // the older one, so its save is refused, nothing written over it.
    const now = (await board.get(before.id))!;
    await board.update(now.id, now.text.replace("A screen made in the door", "A screen made in the door (tidied)"), now.revision!, { kind: "agent", id: "tidier" });
    await until(() => madeScreen("potting")!.revision > now.revision!, "the door read the tidied note");
    await expect(mine("screen.save", { name: "potting" })).rejects.toThrow(/changed since this screen was read/);
    // Read again (the refusal did), the next save writes over the new one.
    await mine("screen.save", { name: "potting" });
    expect((await board.get(before.id))!.text).not.toContain("(tidied)");
  });

  test("a note edited into a screen note is one, by the change feed; one that isn't JSON still keeps its name from a twin", async () => {
    const plain = await board.request<any>("create", { parentId: null, text: "Seed trays\nJust a note for now.", author: "user" });
    const text = screenNoteText(readSpec({ name: "trays", title: "trays", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } }));
    await board.update(plain.id, text, plain.revision, { kind: "user" });
    await until(() => screenNames().includes("trays"), "the edited note registered");
    // A second note named trays whose JSON is broken: trays is two notes' name now, so neither opens.
    await board.request<any>("create", { parentId: null, text: "trays [type::screen] [screen::trays]\n\n```json\n{ not json\n```", author: "user" });
    await until(() => !screenNames().includes("trays"), "trays no longer opens");
    expect(screenNoteProblems().join("\n")).toMatch(/2 screen notes are named trays/);
  });

  test("a name that is neither built in nor a screen note is refused by screen.open, with the screens there are", async () => {
    await expect(app.dispatch.act({ action: "screen.open", args: { name: "nonesuch" } }, { kind: "user" })).rejects.toThrow(/no screen "nonesuch", built in or made \(a screen note\) · screens: .*blank/);
  });

  test("two notes with one name open neither, and say which; a built-in's name is never taken", async () => {
    const text = screenNoteText(readSpec({ name: "twin", title: "twin", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } }));
    await board.request<any>("create", { parentId: null, text, author: "user" });
    await board.request<any>("create", { parentId: null, text, author: "user" });
    await board.request<any>("create", { parentId: null, text: screenNoteText(readSpec({ name: "desk", title: "desk", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } })), author: "user" });
    await loadScreenNotes(board);
    expect(screenNames()).not.toContain("twin");
    expect(screenNoteProblems().join("\n")).toMatch(/2 screen notes are named twin/);
    expect(screenNoteProblems().join("\n")).toMatch(/a screen note is named desk, a built-in screen's name/);
    expect(madeScreen("desk")).toBeUndefined();
  });

  test("layout.load lays the desk out as a screen someone made; screen.delete trashes its note (the person's asks first)", async () => {
    const desk = openScreen("desk") as Desk;
    app.push(desk);
    await mine("layout.load", { name: "potting" });
    expect(get().tiles.map(t => t.name)).toContain("detail-preview");
    expect((await agent("screen.delete", { name: "desk" }).catch(e => e.message))).toMatch(/built-in screen: it can't be deleted/);
    // The person's: asked, then done.
    expect(await mine("screen.delete", { name: "potting" })).toMatchObject({ armed: true });
    const gone = await mine("screen.delete", { name: "potting" }) as any;
    expect(gone).toMatchObject({ screen: "potting", trashed: true });
    expect(await board.isTrashed(gone.note)).toBe(true);
    expect(screenNames()).not.toContain("potting");
  });

  test("an agent starts a blank screen with a query lane on a named view; the person's Q picks the view", async () => {
    await app.dispatch.act({ action: "screen.open", args: { name: "blank" } }, { kind: "user" });
    await until(() => top().name === "blank", "a blank screen");
    await agent("blank.fill", { kind: "query", view: notes.view.id }, "blank");
    expect(get().tiles.map(t => t.kind)).toEqual(["query"]);
    const text = () => { render(); return top().render((top() as any).ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, ""); };
    await until(() => text().includes("nothing in Sowing list yet"), "the empty lane says what it lists");
    // The person's Q: the views to pick from, then the lane.
    await app.dispatch.act({ action: "screen.open", args: { name: "blank" } }, { kind: "user" });
    await until(() => get().tiles[0]?.kind === "blank", "a blank screen");
    render();
    key({ kind: "char", ch: "Q" });
    await until(() => text().includes("a query lane: which saved view's cards") && text().includes("Sowing list"), "the views picker");
    key({ kind: "enter" });
    await until(() => get().tiles[0]?.kind === "query", "the lane in the blank tile's place");
  });

  test("an empty detail says what it's for: where opens land in it, or how to send them there", async () => {
    await app.dispatch.act({ action: "screen.open", args: { name: "blank" } }, { kind: "user" });
    await until(() => top().name === "blank" && get().tiles.length === 1 && get().tiles[0].kind === "blank", "another blank screen");
    await mine("blank.fill", { kind: "detail" }, "blank");
    const said = () => { render(); return top().render((top() as any).ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, ""); };
    expect(said()).toContain("keeps the note opened into it");
    await mine("tile.preview", { where: "right" }, "detail");
    expect(said()).toContain("what you open in detail lands here");
    // ^W v again: its opens already land there, and the person is told so, not left wondering.
    await mine("tile.preview", { where: "down" }, "detail");
    expect((app as any).message).toContain("detail already opens into detail-preview: showed it · alt+l then click detail-preview to unlink");
  });
});
