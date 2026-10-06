// The welcome screen: notes with [welcome::…], one read at a time; links and backlinks in one preview.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Art, Cell } from "../src/ansi";
import { App, type Screen } from "../src/app";
import type { Msg } from "../src/board";
import { densest, logoCells, orderWelcome, WELCOME_VIEW_TEXT, placeOfKey, tabKey, type WelcomeDetail, type WelcomeList, type WelcomePreview } from "../src/hub/welcome";
import { BacklinksPane } from "../src/desk/backlinks-pane";
import { Desk } from "../src/desk/desk";
import { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { landingOf, startScreens, type ScreenRequest } from "../src/start";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const row = (id: string, welcome: string, title = id, createdAt = 0): Msg =>
  ({ id, text: title, parentId: null, childIds: [], createdAt, updatedAt: createdAt, author: null, props: { welcome } });
const art = (lines: string[]): Art => {
  const w = Math.max(...lines.map(l => l.length));
  const rows: Cell[][] = lines.map(l => [...l.padEnd(w)].map(c => ({ code: c.charCodeAt(0), fg: 7, bg: 0 })));
  return { name: "test", width: w, height: rows.length, rows, sauce: null, bytes: 0 };
};

describe("which notes are welcome notes, in what order", () => {
  test("the Welcome view's hand-set order first; any the order doesn't place after, by title; the value only marks a note", () => {
    const list = [row("z", "true", "Zebra notes"), row("two", "true", "House rules"), row("a", "yes", "Apple notes"), row("one", "true", "Start here"), row("ten", "10", "Late")];
    expect(orderWelcome(list, ["one", "two", "ten"]).map(m => m.id)).toEqual(["one", "two", "ten", "a", "z"]);
    // With no Welcome view: by title, whatever the values are (a number is no longer a place).
    expect(orderWelcome(list).map(m => m.id)).toEqual(["a", "two", "ten", "one", "z"]);
  });
  test("the keys: 1-9 then 0 for the tenth; none after", () => {
    expect([0, 8, 9, 10].map(tabKey)).toEqual(["1", "9", "0", null]);
    expect(["1", "9", "0"].map(placeOfKey)).toEqual([0, 8, 9]);
  });
});

describe("the logo band", () => {
  test("a signature line with a phone number is cropped, and blank rows and columns trimmed", () => {
    const a = art(["", "   ::....::   ", "   :: ep ::   ", "   +o Someone 555-010-0199   ", "   ::....::   ", ""]);
    const c = logoCells(a, { file: "x" });
    expect(c.rows.map(r => String.fromCharCode(...r.map(x => x.code)))).toEqual(["::....::", ":: ep ::", "::....::"]);
    expect(c.width).toBe(8);
    expect(logoCells(art(["abc", "555-0199 x", "def"]), { file: "x", rows: [0, 2] }).rows.length).toBe(1);
  });
  test("any way a phone number is written crops its line; a year or a baud rate stays", () => {
    const lines = ["::a::", "(905) 555.0199", "::b::", "+1 905 555 0199", "::c::", "call 9055550199", "::d::", "555 0199 ::", "est. 1996 - 1997", "28800 baud"];
    const kept = logoCells(art(lines), { file: "x" }).rows.map(r => String.fromCharCode(...r.map(x => x.code)).trim());
    expect(kept).toEqual(["::a::", "::b::", "::c::", "::d::", "est. 1996 - 1997", "28800 baud"]);
  });
  test("a short band keeps the rows with the most ink, not the dotted frame", () => {
    const rows = art([":......:", ":  ::  :", ":$$$$$$:", ":$$  $$:", ":......:"]).rows;
    expect(densest(rows, 2).map(r => String.fromCharCode(...r.map(x => x.code)))).toEqual([":$$$$$$:", ":$$  $$:"]);
  });
});

describe("where the door opens", () => {
  const logon = (then?: ScreenRequest) => ({ title: then ? `logon, then ${then.name}` : "logon" }) as Screen;
  test("--screen welcome opens it over the main menu; EP0CH_LANDING=welcome lands there after the logon", () => {
    expect(startScreens(["--screen", "welcome"], {}, logon)).toEqual({ screens: [expect.any(MainMenu)], open: { name: "welcome" } });
    expect(startScreens([], { EP0CH_LANDING: "welcome" }, logon).screens.map(x => x.title)).toEqual(["logon, then welcome"]);
    expect(landingOf({ EP0CH_LANDING: " welcome " })).toEqual({ name: "welcome" });
  });
});

describe.skipIf(!outliner)("the welcome screen", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const press = (k: Key) => key(k);
  /** The person has been away from the keys longer than the idle window: an agent may move what they see. */
  const idle = () => { (app as any).lastInput = 0; };
  const ch = (c: string) => press({ kind: "char", ch: c });
  const mouse = (x: number, y: number, mods?: number) => { press({ kind: "mouse", action: "down", button: 0, x, y, ...(mods ? { mods } : {}) }); press({ kind: "mouse", action: "up", button: 0, x, y, ...(mods ? { mods } : {}) }); };
  const top = () => (app as any).stack.at(-1) as Desk;
  const tileOf = <P>(name: string) => top().pane(name) as P;
  /** The welcome list (its notes), the detail, the preview and the backlinks: the screen's tiles, by name. */
  const list = () => tileOf<WelcomeList>("welcome");
  const lines = () => top().render(app).lines.map(plain);
  const screen = () => lines().join("\n");
  /** Where `text` is drawn: its column and row. */
  const at = (text: string, after = 0) => { const ls = lines(); for (let y = after; y < ls.length; y++) { const x = ls[y]!.indexOf(text); if (x >= 0) return { x, y }; } throw new Error(`${text} isn't on screen:\n${ls.join("\n")}`); };
  const focus = () => (top().describe() as any).focusName;
  const n = {} as Record<"kettle" | "start" | "rules" | "apple" | "shelf", Msg>;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("C opens it; with no welcome notes it says how to tag one, and shows [[claude-now]] once there is one", async () => {
    app.push(new MainMenu());
    ch("C");
    expect(top().name).toBe("welcome");
    await until(() => list().items !== null, "the welcome notes asked for");
    expect(screen()).toContain("No note is a welcome note");
    expect(screen()).toContain("Tag one [welcome::true]");
    expect(screen()).toContain("Nothing to read yet");
    idle();
    await expect(app.act({ action: "welcome.select", args: { n: 1 }, as: "test-agent" })).rejects.toThrow(/no note is a welcome note yet/);
    const page = await board.createBlock(null, "Claude · now [page::claude-now] [type::agent-status]\nStart here: the jam jars.");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === page.id, "the fallback page, once it exists");
    await until(() => screen().includes("Start here: the jam jars."), "the page drawn");
    expect(screen()).toContain("Meanwhile the detail shows");
    expect((app.describe() as any).state).toMatchObject({ kind: "welcome", welcome: [], fallback: { page: "claude-now", id: page.id } });
  });

  test("an outline with no notes of its own offers + New note (PIE-544): a click makes one in the Inbox and opens it to write; esc on it empty trashes it", async () => {
    expect(screen()).toContain("+ New note · ctrl+n");
    expect(screen()).toContain("^N new");
    const inbox = (await board.roots()).find(r => r.props["system-view"] === "inbox")!.id;
    const before = (await board.children(inbox)).length;
    const drafting = () => [...(top() as any).panes.values()].find((p: any) => p.surface?.draft) as any;
    const { x, y } = at("+ New note");
    mouse(x + 1, y);
    await until(() => !!drafting(), "the new note's edit", 8000);
    const id = drafting().surface.draft.blockId;
    expect((await board.get(id))!.parentId).toBe(inbox);
    press({ kind: "esc" });
    await until(() => !drafting(), "the edit closed", 5000);
    const end = Date.now() + 5000;
    while ((await board.children(inbox)).length !== before && Date.now() < end) await Bun.sleep(30);
    expect((await board.children(inbox)).length).toBe(before);
    // The keys back where the screen opened them, for what follows.
    top().focusTile("detail", { kind: "user" });
  }, 30_000);

  test("tagged notes replace the fallback, in order; the first is the detail and has the keys", async () => {
    n.kettle = await board.createBlock(null, "The kettle\nIt whistles now.");
    n.shelf = await board.createBlock(null, `Tea shelf\nNext to ((${n.kettle.id}|the kettle)).`);
    n.rules = await board.createBlock(null, "House rules [welcome::true]\nWipe the counter.");
    n.apple = await board.createBlock(null, "Apple notes [welcome::true]\nCrisp ones only.");
    n.start = await board.createBlock(null, `Start here [welcome::true]\nFirst, boil ((${n.kettle.id}|the kettle)). Then read the rules.`);
    // No Welcome view yet: by title. Start here goes first by hand (alt+↑ in the list, twice), which makes the view.
    await until(() => list().items?.length === 3, "three welcome notes");
    expect(list().items!.map(m => m.id)).toEqual([n.apple.id, n.rules.id, n.start.id]);
    expect(list().orderView).toBeNull();
    await top().dispatch.act({ action: "welcome.select", args: { id: n.start.id } }, { kind: "user" });
    press({ kind: "tab" }); press({ kind: "tab" }); press({ kind: "tab" });
    expect(focus()).toBe("welcome");
    press({ kind: "alt-up" });
    await until(() => list().items?.[1]?.id === n.start.id && !!list().orderView, "alt+↑: one place up, the Welcome view made");
    expect((app as any).message).toContain("made the Welcome view");
    press({ kind: "alt-up" });
    await until(() => list().items?.[0]?.id === n.start.id, "alt+↑ again: first");
    expect((await board.get(list().orderView!.id))!.text).toContain("[query::welcome]");
    // A drag in the list: House rules (third now) dropped on the second row.
    const listRect = (top().layoutGet() as any).tiles.find((t: any) => t.name === "welcome").rect;
    const rulesRow = at("House rules", listRect.row), appleRow = at("Apple notes", listRect.row);
    press({ kind: "mouse", action: "down", button: 0, x: rulesRow.x, y: rulesRow.y }); press({ kind: "mouse", action: "up", button: 0, x: appleRow.x, y: appleRow.y });
    await until(() => list().items?.[1]?.id === n.rules.id, "the drag: House rules second");
    // An agent's move, by act, is said; the order is the view's, so `ep0ch view order` would show the same.
    idle();
    await app.act({ action: "welcome.move", args: { id: n.apple.id, to: 3 }, as: "test-agent" });
    expect(list().items!.map(m => m.id)).toEqual([n.start.id, n.rules.id, n.apple.id]);
    expect((await board.viewOrder(list().orderView!.id)).blockIds.slice(0, 3)).toEqual([n.start.id, n.rules.id, n.apple.id]);
    // The first in the order is 1: picked, it's the detail, with the keys.
    ch("1");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.start.id, "1: Start here, first by hand");
    await until(() => screen().includes("First, boil"), "the first note drawn");
    expect(list().items!.map(m => m.id)).toEqual([n.start.id, n.rules.id, n.apple.id]);
    expect(focus()).toBe("detail");
    const tabs = at("1 Start here");
    expect(lines()[tabs.y]).toMatch(/\[=.*1 Start here =.*2 House rules =.*3 Apple notes =+\]/);
    expect(screen()).toContain("welcome 1 · Start here");
  });

  test("digits and clicks on tabs pick a note; the list down the side does too", async () => {
    ch("2");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.rules.id, "2: the second");
    expect(focus()).toBe("detail");
    const tab = at("3 Apple notes");
    mouse(tab.x + 2, tab.y);
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.apple.id, "a click on the third tab");
    ch("9");
    await until(() => (app as any).message?.includes("pick 1 to 3"), "9: no ninth, said");
    press({ kind: "tab", }); press({ kind: "backtab" }); press({ kind: "backtab" });
    expect(focus()).toBe("welcome");
    ch("k");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.rules.id, "k in the list: the one above");
    expect(focus()).toBe("welcome");
    press({ kind: "enter" });
    await until(() => focus() === "detail", "⏎ in the list reads it: the detail has the keys");
    ch("1");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.start.id, "back to the first");
  });

  test("⏎ on a link in the detail opens it in the preview; alt+⏎ reads it in the detail; back returns", async () => {
    await until(() => screen().includes("First, boil"), "the start note drawn");          // [ ] step through what's drawn
    ch("]");
    press({ kind: "enter" });
    await until(() => tileOf<WelcomePreview>("preview").msg?.id === n.kettle.id, "the kettle in the preview");
    expect(tileOf<WelcomeDetail>("detail").msg?.id).toBe(n.start.id);
    expect(focus()).toBe("detail");
    await until(() => screen().includes("preview · The kettle"), "the preview's header");
    press({ kind: "alt-enter" });
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.kettle.id, "alt+⏎: the kettle is read in the detail");
    expect(screen()).toContain("read here · The kettle");
    press({ kind: "backspace" });
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.start.id, "back: the start note again");
  });

  test("a click on a link opens it in the preview; a ctrl-click reads it in the detail", async () => {
    tileOf<WelcomePreview>("preview").show(null, top());
    const link = at("the kettle", at("First, boil").y);
    mouse(link.x + 1, link.y);
    await until(() => tileOf<WelcomePreview>("preview").msg?.id === n.kettle.id, "the click: preview");
    expect(tileOf<WelcomeDetail>("detail").msg?.id).toBe(n.start.id);
    mouse(link.x + 1, link.y, 16);
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.kettle.id, "the ctrl-click: detail");
  });

  test("the detail's backlinks run under it and show in the same preview; alt+⏎ reads one here", async () => {
    await until(() => tileOf<BacklinksPane>("backlinks").data !== null && tileOf<BacklinksPane>("backlinks").target?.id === n.kettle.id, "the kettle's backlinks");
    await until(() => screen().includes("Tea shelf"), "the backlinks drawn");
    expect(screen()).toContain("Start here");
    const rows = (top().describe() as any).panes.find((p: any) => p.name === "backlinks").backlinks.rows as { id?: string; text: string }[];
    const shelfRow = rows.findIndex(r => r.id === n.shelf.id) + 1;
    expect(shelfRow).toBeGreaterThan(0);
    // By keys: Tab to the backlinks, move to the shelf, and it shows in the preview.
    while (focus() !== "backlinks") press({ kind: "tab" });
    tileOf<BacklinksPane>("backlinks").sel = 0;
    for (let i = 1; i < shelfRow; i++) ch("j");
    await until(() => tileOf<WelcomePreview>("preview").msg?.id === n.shelf.id, "the selected backlink in the preview");
    expect(tileOf<WelcomeDetail>("detail").msg?.id).toBe(n.kettle.id);
    press({ kind: "alt-enter" });
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.shelf.id, "alt+⏎ on a backlink: read here");
    expect(focus()).toBe("detail");
    press({ kind: "backspace" });
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.kettle.id, "back to the kettle");
    // By the mouse: a click on a backlink row shows it in the preview.
    tileOf<WelcomePreview>("preview").show(null, top());
    await until(() => tileOf<BacklinksPane>("backlinks").target?.id === n.kettle.id && tileOf<BacklinksPane>("backlinks").data !== null, "the kettle's backlinks, read again");
    const r = at("Tea shelf", at("links · The kettle").y);
    mouse(r.x, r.y);
    await until(() => tileOf<WelcomePreview>("preview").msg?.id === n.shelf.id, "the clicked backlink in the preview");
  });

  test("Tab goes detail → backlinks → preview → list; landing on the backlinks shows the selected row", async () => {
    ch("1");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.start.id && focus() === "detail", "the start note");
    idle();
    await app.act({ action: "welcome.read", args: { id: n.kettle.id } });
    await until(() => tileOf<BacklinksPane>("backlinks").target?.id === n.kettle.id && tileOf<BacklinksPane>("backlinks").data !== null, "the kettle's backlinks");
    tileOf<WelcomePreview>("preview").show(null, top());
    tileOf<BacklinksPane>("backlinks").sel = tileOf<BacklinksPane>("backlinks").rows().findIndex(r => r.kind === "backlink");
    const first = (tileOf<BacklinksPane>("backlinks").rows()[tileOf<BacklinksPane>("backlinks").sel] as any).source.blockId as string;
    const before = JSON.stringify((top().describe() as any).panes.map((p: any) => p.rect));
    const order: string[] = [];
    for (let i = 0; i < 4; i++) { press({ kind: "tab" }); order.push(focus()); }
    expect(order).toEqual(["backlinks", "preview", "welcome", "detail"]);
    await until(() => tileOf<WelcomePreview>("preview").msg?.id === first, "the selected backlink shown on landing");
    // Giving a tile the keys never moves a tile.
    expect(JSON.stringify((top().describe() as any).panes.map((p: any) => p.rect))).toBe(before);
    // No tile numbers in the headers: the digits pick notes here.
    expect(screen()).toContain("links · The kettle");
    expect(screen()).not.toMatch(/\.\. ?\d (welcome|backlinks|preview)/);
  });

  test("the preview's note is read in the detail by alt+⏎ or a click on ⇱ read here", async () => {
    await until(() => !!tileOf<WelcomePreview>("preview").msg, "something in the preview");
    const shown = tileOf<WelcomePreview>("preview").msg!.id;
    while (focus() !== "preview") press({ kind: "tab" });
    press({ kind: "alt-enter" });
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === shown, "alt+⏎ in the preview: read in the detail");
    expect(focus()).toBe("detail");
    press({ kind: "backspace" });
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.kettle.id, "back");
    tileOf<WelcomePreview>("preview").show(n.rules, top());
    const c = at("⇱ read here");
    mouse(c.x + 2, c.y);
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.rules.id, "a click on ⇱ read here");
  });

  test("alt+l, then a digit, links a tile (the desk's), not a welcome pick", async () => {
    ch("1");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.start.id, "the start note");
    press({ kind: "alt", ch: "l" });
    ch("2");
    expect(tileOf<WelcomeDetail>("detail").msg?.id).toBe(n.start.id);
    await Bun.sleep(50);
    expect(tileOf<WelcomeDetail>("detail").msg?.id).toBe(n.start.id);
  });

  test("agents pick, read and preview without taking the person's keys; never while they type", async () => {
    ch("1");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.start.id && focus() === "detail", "the start note");
    while (focus() !== "welcome") press({ kind: "tab" });
    // Within the idle window an agent's pick waits (the person's key may be in flight); then it goes ahead.
    await expect(app.act({ action: "welcome.select", args: { n: 2, read: true }, as: "test-agent" })).rejects.toThrow(/at the keys/);
    idle();
    expect(await app.act({ action: "welcome.select", args: { n: 2, read: true }, as: "test-agent" })).toMatchObject({ id: n.rules.id, n: 2, of: 3 });
    expect(focus()).toBe("welcome");
    expect((app as any).message).toContain("an agent (test-agent) put House rules in the detail (welcome 2)");
    expect(await app.act({ action: "welcome.read", args: { id: n.kettle.id }, as: "test-agent" })).toMatchObject({ id: n.kettle.id, n: null });
    expect(focus()).toBe("welcome");
    await until(() => tileOf<BacklinksPane>("backlinks").target?.id === n.kettle.id && tileOf<BacklinksPane>("backlinks").data !== null, "the kettle's backlinks");
    await app.act({ action: "backlinks.pick", args: { id: n.start.id }, as: "test-agent" });
    await until(() => tileOf<WelcomePreview>("preview").msg?.id === n.start.id, "an agent's pick in the preview");
    expect(focus()).toBe("welcome");
    expect(await app.act({ action: "welcome.logo", as: "test-agent" })).toHaveProperty("logo");
    // The person edits the detail: an agent's pick waits.
    ch("1");
    await until(() => focus() === "detail" && tileOf<WelcomeDetail>("detail").msg?.id === n.start.id, "the start note, read");
    ch("e"); press({ kind: "enter" });   // e arms the edit, ⏎ opens it (edit.arm)
    await until(() => !!tileOf<WelcomeDetail>("detail").draft, "the person's edit");
    idle();
    await expect(app.act({ action: "welcome.select", args: { n: 2 }, as: "test-agent" })).rejects.toThrow(/the person is typing on the welcome/);
    ch("2");                                                                         // typed into the edit, not a pick
    expect(tileOf<WelcomeDetail>("detail").msg?.id).toBe(n.start.id);
    press({ kind: "esc" }); press({ kind: "esc" });
    await until(() => !tileOf<WelcomeDetail>("detail").draft, "the edit closed");
  });

  test("past ten notes the tenth is 0 and the rest are … more, which goes to the list", async () => {
    for (let i = 3; i <= 12; i++) await board.createBlock(null, `Extra ${String(i).padStart(2, "0")} [welcome::true]`);
    await until(() => list().items?.length === 13, "thirteen welcome notes");
    await until(() => screen().includes("… 3 more"), "the more tab");
    ch("0");
    await until(() => list().at === 9, "0: the tenth");
    const more = at("… 3 more");
    mouse(more.x + 1, more.y);
    await until(() => focus() === "welcome", "… more: the list has the keys");
    expect(screen()).toMatch(/… 3 more/);
  });

  test("q goes back to the menu, and C comes back here", async () => {
    ch("q");
    expect((app as any).stack.at(-1)).toBeInstanceOf(MainMenu);
    ch("C");
    expect(top().name).toBe("welcome");
    await until(() => tileOf<WelcomeDetail>("detail").msg?.id === n.start.id, "the first welcome note again");
    expect(focus()).toBe("detail");
  });
});

describe.skipIf(!outliner)("a backlinks tile on the desk", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("moving its selection shows the row where its selection goes; the reader it lists the backlinks of stays", async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    const lamp = await board.createBlock(null, "The lamp\nIt flickers.");
    const a = await board.createBlock(null, `Porch\nThe ((${lamp.id}|lamp)) by the door.`);
    const b = await board.createBlock(null, `Hall\nAnother ((${lamp.id}|lamp)).`);
    const desk = new Desk({ name: "test", title: "test", layout: { root: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "reader", name: "reader" }, b: { t: "leaf", kind: "backlinks", name: "backlinks", source: "tile:reader", groups: "open" } } } });
    const reader = desk.pane("reader") as ReaderPane, bl = desk.pane("backlinks") as BacklinksPane;
    app.push(desk);
    desk.setCurrent(lamp);
    await until(() => bl.target?.id === lamp.id && bl.data !== null && bl.rows().some(r => r.kind === "backlink"), "the lamp's backlinks");
    await app.act({ action: "tile.focus", tile: "backlinks" });
    const d = desk as any;
    d.key({ kind: "char", ch: "j" }, d.ctx);
    d.key({ kind: "char", ch: "k" }, d.ctx);
    await Bun.sleep(200);
    expect(reader.msg?.id).toBe(lamp.id);
    expect(bl.target?.id).toBe(lamp.id);
    // ⏎ opens it: the reader follows the current note, as an open from any list does.
    await app.act({ action: "backlinks.pick", args: { id: a.id, open: true } });
    await until(() => reader.msg?.id === a.id, "⏎: the source is the current note");
    void b;
  }, 30_000);
});

describe.skipIf(!outliner)("the one-off: [welcome::n] numbers become the Welcome view's hand-set order", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  beforeAll(async () => { board = new SocketBoard(await scratch.start()); await board.info(); }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  const run = (...more: string[]) => {
    const env = { ...(process.env as Record<string, string>), ...scratch.env };
    delete env.EP0CH_SOCKET;
    const r = Bun.spawnSync(["bun", "scripts/welcome-order.ts", "--ws", scratch.name, ...more], { cwd: join(import.meta.dir, ".."), env });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };

  test("a dry run says the order and writes nothing; --apply makes the view, sets its order and rewrites the values to true", async () => {
    const user = { kind: "user" } as const;
    const rules = await board.createBlock(null, "House rules [welcome::2]\nWipe the counter.", user);
    const start = await board.createBlock(null, "Start here [welcome::1]\nBoil the kettle.", user);
    const apple = await board.createBlock(null, "Apple notes [welcome::yes]\nCrisp ones only.", user);
    const dry = run();
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/1\. Start here \[welcome::1\][\s\S]*2\. House rules \[welcome::2\][\s\S]*3\. Apple notes \[welcome::yes\]/);
    expect(dry.out).toContain("this order is set on the Welcome view this run makes");
    expect(dry.out).toContain("nothing written yet");
    expect((await board.get(start.id))!.props.welcome).toBe("1");
    const done = run("--apply");
    expect(done.code).toBe(0);
    expect(done.out).toContain("✓ 3 value(s) rewritten to true");
    for (const m of [rules, start, apple]) expect((await board.get(m.id))!.props.welcome).toBe("true");
    const { welcomeView, findWelcome } = await import("../src/hub/welcome");
    const view = await welcomeView(board);
    expect(view!.props).toMatchObject({ type: "virtual-branch", query: "welcome" });
    expect((await findWelcome(board)).notes.map(m => m.id)).toEqual([start.id, rules.id, apple.id]);
    // The view it made is the agent's that ran it (a property patch keeps the note's own author).
    expect((await board.get(view!.id))!.author).toBe("welcome-order");
    // Again: nothing left to rewrite, the same order.
    expect(run("--apply").out).toContain("0 value(s) to rewrite");
    expect((await findWelcome(board)).notes.map(m => m.id)).toEqual([start.id, rules.id, apple.id]);
  }, 60_000);
});
