// The keys window (PIE-492) and the keymap file it writes: every binding filtered with its scope, what each key does and
// what it takes its key from, a rebind said before it lands and saved in one file (keybindings.json in the state dir),
// and every key table, hint and menu following it. A scratch host and a scratch state dir; fixtures made up.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { openScreen } from "../src/desk/screen-specs";
import { wKey, wRows } from "../src/desk/wkeys";
import { SocketBoard, USER } from "../src/socket";
import { fitHint, visible } from "../src/style";
import { bindings, conflicts, fightOf, rebindEffects, unbound, type Binding } from "../src/surface/key-catalog";
import { allActionSets } from "../src/surface/actions";
import { DRAFT_ACTIONS } from "../src/edit";
import { declaredOf, effective, keysNow, keymapEntries, keymapProblem, resetKeys, keymapPath, moved, asTyped, parse, reloadKeymap, setKeys, undoKeymap } from "../src/surface/keymap";
import type { Key } from "../src/term";
import { traceActions } from "../src/surface/actions";
import { traceRequests } from "../src/surface/dispatch";
import { formOpen } from "../src/bar/ask";
import { outliner, Scratch, until } from "./scratch";
import "../src/screens";

const char = (ch: string, ctrl = false): Key => ({ kind: "char", ch, ...(ctrl ? { ctrl: true } : {}) });
const file = () => JSON.parse(readFileSync(keymapPath(), "utf8"));

describe("the keymap file", () => {
  const was = process.env.EP0CH_KEYMAP;
  beforeAll(() => { process.env.EP0CH_KEYMAP = join(mkdtempSync(join(tmpdir(), "keymap-")), "keybindings.json"); reloadKeymap(); });
  afterEach(() => { writeFileSync(keymapPath(), "{}\n"); reloadKeymap(); });
  afterAll(() => { if (was === undefined) delete process.env.EP0CH_KEYMAP; else process.env.EP0CH_KEYMAP = was; reloadKeymap(); });

  test("the outliner's shape: an act line to its keys; a bad key or line is said and left out, the rest hold", () => {
    const r = parse(JSON.stringify({ "tile.close": ["^W q"], "element.select by=1": ["n", "]"], "note.new": ["two keys"], callouts: [] }));
    expect(r.entries.map(e => [e.id, e.keys])).toEqual([["tile.close", ["ctrl+w q"]], ["element.select by=1", ["n", "]"]], ["note.new", []], ["callouts", []]]);
    expect(r.problem).toContain(`"two keys" isn't a key or a ^W chord`);
    expect(parse("{ not json").problem).toContain("isn't JSON");
  });

  test("a table follows it: the ^W keys find tile.close at its new key, and the old one is gone", () => {
    expect(wKey("x")?.action).toBe("tile.close");
    setKeys("tile.close", ["ctrl+w q"]);
    expect(wKey("q")?.action).toBe("tile.close");
    expect(wKey("x")).toBeUndefined();
    expect(wRows(() => undefined).find(r => r.key === "q")?.action).toBe("tile.close");
    expect(file()).toEqual({ "tile.close": ["ctrl+w q"] });
    // Undo puts the file back as it was.
    expect(undoKeymap()).toBe(true);
    expect(keymapEntries()).toEqual([]);
    expect(wKey("x")?.action).toBe("tile.close");
  });

  test("a key the file takes from a mode's binding is the new binding's there, and nowhere else", () => {
    const rows = [{ key: "j", action: "a.pick", label: "down" }, { key: "q", action: "a.close", label: "close" }, { key: "esc", action: "a.close", label: "close" }];
    const other = [{ key: "j", action: "b.pick", label: "down" }];
    setKeys("a.close", ["j"]);
    expect(effective(rows).map(r => `${r.key}=${r.action}`)).toEqual(["j=a.close"]);
    expect(effective(other).map(r => `${r.key}=${r.action}`)).toEqual(["j=b.pick"]);
  });

  test("a key matched in code that the file moved runs nothing and says where it went; its other keys still work", () => {
    setKeys("callouts", ["Z"]);
    expect(asTyped("z", () => moved("callouts", {}, [{ keys: "z", does: "callouts" }]))).toContain("z no longer runs callouts: your keymap gives it Z");
    expect(asTyped("Z", () => moved("callouts", {}, [{ keys: "z", does: "callouts" }]))).toBeNull();
    // Only the first action a key runs is asked, and never an agent's act (no key typed).
    expect(moved("callouts", {}, [{ keys: "z", does: "callouts" }])).toBeNull();
  });

  test("the catalog lists every binding with its scope and layer, and a rebind says what it takes before it lands", () => {
    const all = bindings();
    const close = all.find(b => b.key === "ctrl+w x" && b.action === "tile.close")!;
    expect(close).toMatchObject({ scope: "^W", layer: "^W", rebind: true });
    const focus = all.find(b => b.key === "ctrl+w h")!;
    expect(focus.rebind).toContain("they move together in code");
    const e = rebindEffects(close, "ctrl+w z", all);
    expect(e.takes.map(t => t.action)).toContain("tile.zoom");
    expect(rebindEffects(close, "q", all).problem).toContain("press ^W, then the key");
    // A screen's own keys are listed under its name, in the screen layer.
    expect(all.some(b => b.layer === "screen" && b.scope === "board")).toBe(true);
  });

  test("Conflicts are keys two bindings really fight over: one lookup, one key, both live; the states of one control aren't", () => {
    // The built-in keys: a key an action set matches in code means one thing at a time (esc clears the bar's line, then
    // closes it; alt+Q starts or stops a recording; ^] goes into a terminal and back), and the board's c folds a reader
    // while the lanes' c collapses a lane. Counted by hand, none of them fight.
    expect(conflicts(bindings()).map(g => g.map(b => `${b.cap} ${b.id}`).join(" | "))).toEqual([]);
    // Two rows of one table on one key: the table is read first to last, so the second never runs, unless the kinds they
    // run for (`only`, `unless`) never meet.
    const row = (id: string, more: Partial<Binding> = {}): Binding => ({ key: "c", cap: "c", action: id, args: {}, id, scope: "a screen", layer: "screen", does: id, about: id, from: "table", rebind: true, table: 7, ...more });
    expect(conflicts([row("tile.collapse"), row("lane.collapse")]).map(g => g.map(b => b.id))).toEqual([["tile.collapse", "lane.collapse"]]);
    expect(conflicts([row("tile.collapse", { only: ["reader"] }), row("lane.collapse", { only: ["lanes"] })])).toEqual([]);
    expect(conflicts([row("tile.collapse", { only: ["reader"] }), row("lane.collapse", { unless: ["reader"] })])).toEqual([]);
    expect(conflicts([row("tile.collapse"), row("lane.collapse", { table: 8 })])).toEqual([]);
    // A file edited by hand that gives one key to two bindings: the App's layer presses the last, so the first never runs.
    writeFileSync(keymapPath(), JSON.stringify({ "note.new": ["alt+j"], "tile.close": ["alt+j"] }));
    reloadKeymap();
    const fights = conflicts(bindings());
    expect(fights.map(g => g.map(b => b.id))).toEqual([["note.new", "tile.close"]]);
    expect(fightOf(fights[0]!)).toMatchObject({ wins: "tile.close", loses: ["note.new"] });
  });

  test("an action's keys list a rebind once, however many dispatchers read them again (Nov 3 review card 1)", () => {
    writeFileSync(keymapPath(), JSON.stringify({ "draft.erase to=word-back": ["alt+z"] }));
    reloadKeymap();
    const once = keysNow("draft.erase", DRAFT_ACTIONS.def("draft.erase")!.keys);
    const thrice = keysNow("draft.erase", keysNow("draft.erase", once));
    const yours = (k: typeof once) => (typeof k === "string" || !k ? [] : k.filter(r => "keys" in r && r.does.startsWith("yours")));
    expect(yours(once)).toEqual([{ keys: "alt+z", does: "yours: to=word-back" }]);
    expect(yours(thrice)).toEqual(yours(once));
  });

  test("a rebind of a draft key onto a key the power bar reads first is a conflict: the bar's binding runs, the rebind does nothing there (Nov 3 review card 1)", () => {
    writeFileSync(keymapPath(), JSON.stringify({ "draft.erase to=word-back": ["alt+j", "alt+backspace"] }));
    reloadKeymap();
    const fights = conflicts(bindings()).filter(g => g.some(b => b.key === "alt+j"));
    expect(fights.map(g => g.map(b => `${b.scope}:${b.id}`))).toEqual([["bar:bar.docs", "draft:draft.erase to=word-back"]]);
    expect(fightOf(fights[0]!)).toMatchObject({ wins: "bar.docs", loses: ["draft.erase to=word-back"] });
    expect(fightOf(fights[0]!).why).toContain("power bar");
    // A key the bar leaves to the line is no fight.
    expect(conflicts(bindings()).some(g => g.some(b => b.key === "alt+backspace"))).toBe(false);
  });

  test("a rebind onto a key a door module takes before every screen (the glass's alt+u) says so first and is a conflict naming it (PIE-1688)", async () => {
    await import("../ext/glass/glass");
    const all = bindings();
    const toggle = all.find(b => b.action === "glass.toggle" && b.key === "alt+u")!;
    // The glass's keys are read in App.route before the drawer, the keymap layer and every screen: its own layer, over a draft's.
    expect(toggle.layer).toBe("door module");
    const clear = all.find(b => b.id === "draft.clear" && b.key === "ctrl+u")!;
    const e = rebindEffects(clear, "alt+u", all);
    expect(e.problem).toBeNull();
    expect(e.over.map(o => o.id)).toContain("glass.toggle");
    expect(e.under.map(o => o.id)).not.toContain("glass.toggle");
    // Saved anyway, it is a conflict the window lists, saying who runs and why.
    setKeys("draft.clear", ["alt+u"]);
    const fights = conflicts(bindings()).filter(g => g.some(b => b.key === "alt+u"));
    expect(fights.map(g => g.map(b => b.id))).toEqual([["glass.toggle", "draft.clear"]]);
    const f = fightOf(fights[0]!);
    expect(f).toMatchObject({ wins: "glass.toggle", loses: ["draft.clear"] });
    expect(f.why).toContain("before every screen");
  });

  test("a key a terminal without key reports can't send is never offered as free: the rebind says so (PIE-1688)", async () => {
    const { KeyDecoder } = await import("../src/term");
    const { needsKeyReports } = await import("../src/kbd");
    // One answer, the decoder's own: ESC and a character is alt and that character exactly where needsKeyReports says nothing.
    const read = (bytes: string) => { const d = new KeyDecoder({ cols: 80, rows: 24, cellW: 9, cellH: 16, kitty: false }); const got: Key[] = []; d.keyHandler = k => got.push(k); d.feed(bytes); return got; };
    for (const ch of "abzAZ09;,[]O'?.") {
      const alt = read(`\x1b${ch}`).some(k => k.kind === "alt" && k.ch === ch);
      expect(alt, `ESC ${ch}`).toBe(needsKeyReports(`alt+${ch}`) === null);
    }
    const clear = bindings().find(b => b.id === "draft.clear" && b.key === "ctrl+u")!;
    for (const key of ["alt+[", "alt+;"]) {
      const e = rebindEffects(clear, key, bindings());
      expect(e.sends, key).toContain("Kitty keyboard protocol");
    }
    expect(rebindEffects(clear, "alt+z", bindings()).sends).toBeNull();
  });

  test("Unbound is every action no key reaches, read from the action sets; a key given to one is said first and moves it out", () => {
    const all = bindings(), un = unbound(all), keyed = new Set(all.map(b => b.action));
    // Every action the door has is on a key or in Unbound, never both and never neither.
    const names = new Set(allActionSets().flatMap(s => s.names()));
    expect([...names].filter(n => keyed.has(n) === un.some(b => b.action === n))).toEqual([]);
    // share.list is reached only by a line typed in the power bar: no key.
    const row = un.find(b => b.action === "share.list")!;
    expect(row).toMatchObject({ key: "", from: "unbound", rebind: true });
    // Giving it a key says first what that key does now, then the key is its, and it leaves Unbound.
    const e = rebindEffects(row, "alt+j", all);
    expect(e.problem).toBeNull();
    setKeys("share.list", ["alt+j"]);
    const now = bindings();
    expect(now.some(b => b.action === "share.list" && b.key === "alt+j" && b.yours)).toBe(true);
    expect(unbound(now).some(b => b.action === "share.list")).toBe(false);
    // An action that can't run without arguments isn't given a bare key: the window says to bind its act line.
    const needs = un.find(b => b.rebind !== true);
    if (needs) expect(String(needs.rebind)).toContain("needs");
  });

  test("resetting one binding by name leaves the action's other entries alone", () => {
    setKeys("element.select by=1", ["n"]);
    setKeys("element.select by=-1", ["p"]);
    resetKeys("element.select by=1");
    expect(keymapEntries().map(e => e.id)).toEqual(["element.select by=-1"]);
  });
});

describe.skipIf(!outliner)("the keys window on a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  let cols = 177, rows = 60, painted: string[] = [];
  /** The door's whole frame as the terminal gets it (the bar, and what is said above it), drawn now. */
  const frame = () => { (app as any).paint(); return painted.map(l => visible(l)); };
  const screen = () => (app as any).stack.at(-1) as any;
  const lines = () => screen().render(screen().ctx).lines.map(visible) as string[];
  const keysWin = () => screen().describe().tiles?.find?.((t: any) => t.keys)?.keys ?? screen().describe().keys;
  const act = (action: string, args: Record<string, unknown> = {}, as?: string) => (as ? app.act({ action, args, as }) : screen().dispatch.act({ action, args }, USER));

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    delete process.env.EP0CH_KEYMAP;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { get cols() { return cols; }, get rows() { return rows; }, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(openScreen("desk"));
  }, 30_000);
  afterAll(async () => {
    for (const s of (app as any).stack) s.dispose?.();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  const shell = (action: string, args: Record<string, unknown> = {}) => (app as any).dispatch.act({ action, args }, USER);
  const desk = () => (app as any).stack.find((x: any) => x.spec?.name === "desk") as any;
  const tiles = () => desk().tiles().length as number;
  const flashes: string[] = [];

  const focusedKind = () => desk().panes.get(desk().focus)?.kind as string | undefined;
  const focusedName = () => desk().nameOf(desk().focus) as string;
  const keysPane = () => [...desk().panes.values()].find((p: any) => p.kind === "keys") as any;

  test("? opens the keys window as a tile beside yours: it resizes like any tile, ⏎ runs a row there, one with arguments asks in the power bar, esc closes it", async () => {
    const before = tiles(), opener = focusedName();
    key(char("?"));
    await until(() => tiles() === before + 1 && focusedKind() === "keys", "a keys tile beside the focused one", 8000);
    expect(screen().spec?.name).toBe("desk");
    expect(keysWin().filter).toStartWith("in:");
    // A tile like any other: it grows by its keys and the layout keeps it.
    await desk().dispatch.act({ action: "tile.resize", args: { by: 2 }, tile: "keys" }, USER);
    // ⏎ on a row that needs nothing runs it where the window was opened from, as its key would there.
    await act("keys.filter", { text: "tile.zoom" });
    const found: any = await act("keys.find", {});
    const n = found.bindings.findIndex((b: any) => b.key === "ctrl+w z") + 1;
    expect(n).toBeGreaterThan(0);
    await act("keys.select", { n });
    const ran: { action: string; tile?: string }[] = [];
    const stop = traceRequests(r => ran.push({ action: r.action, ...(r.tile ? { tile: r.tile.name } : {}) }));
    key({ kind: "enter" });
    await until(() => ran.some(r => r.action === "tile.zoom"), "⏎ ran tile.zoom");
    stop();
    expect(ran.find(r => r.action === "tile.zoom")?.tile).toBe(opener);
    await desk().dispatch.act({ action: "tile.zoom", args: {}, tile: opener }, USER);
    // ? again goes back to the same keys tile; a row whose action needs arguments opens its form in the power bar.
    key(char("?"));
    await until(() => focusedKind() === "keys", "back in the keys tile");
    expect(tiles()).toBe(before + 1);
    await act("keys.filter", { text: "tile.open ^W" });
    const open: any = await act("keys.find", {});
    await act("keys.select", { n: open.bindings.findIndex((b: any) => b.id === "tile.open") + 1 });
    key({ kind: "enter" });
    await until(() => formOpen(), "tile.open's form in the power bar");
    await shell("bar.close", {});
    // Esc closes it, as q does.
    key(char("?"));
    await until(() => focusedKind() === "keys", "the keys tile again");
    key({ kind: "esc" });
    await until(() => tiles() === before, "esc closed the keys tile");
    expect(focusedName()).toBe(opener);
  });

  test("the Unbound tab: its count in the label, filtered like the others, r gives a row a key with what it takes said first", async () => {
    key(char("?"));
    await until(() => focusedKind() === "keys", "the keys tile");
    await act("keys.filter", { text: "" });
    await act("keys.tab", { tab: "unbound" });
    const total = keysWin().rows as number;
    expect(total).toBeGreaterThan(0);
    expect(keysPane().render(90, 30, true, desk()).lines.map(visible).join("\n")).toContain(`Unbound ${total}`);
    await act("keys.filter", { text: "share.list" });
    expect(keysWin().selected).toMatchObject({ id: "share.list", key: "" });
    // r, then the new key: what alt+j does now is said before it saves.
    key(char("r"));
    await until(() => keysWin().record?.id === "share.list", "waiting for the key");
    key({ kind: "alt", ch: "j" });
    await until(() => keysWin().record?.key === "alt+j", "the new key read");
    key({ kind: "enter" });
    await until(() => file()["share.list"]?.includes("alt+j"), "saved in the keymap");
    expect(keysWin().rows).toBe(0);
    await act("keys.reset", { id: "share.list" });
    expect(keysWin().rows).toBe(1);
    // At 40 columns the four tabs and their counts still show (two rows when they don't fit one).
    const narrow = keysPane().render(40, 30, true, desk()).lines.map(visible).join("\n");
    expect(narrow).toContain("Unbound");
    expect(narrow).toContain("Conflicts 0");
    key({ kind: "esc" });
    await until(() => focusedKind() !== "keys", "closed");
  });

  test("the first ? opens the keys window, even with the hint row cut or after a click inside a tile; a frame's card needs the pointer on the frame", async () => {
    cols = 90; rows = 40;
    try {
      desk().render(desk().ctx);
      const r = desk().rectOf(desk().panes.get(desk().focus));
      const x = r.col + Math.floor(r.cols / 2), y = r.row + Math.floor(r.rows / 2);
      key({ kind: "mouse", action: "down", button: 0, x, y }); key({ kind: "mouse", action: "up", button: 0, x, y });
      key(char("?"));
      await until(() => focusedKind() === "keys", "the keys window on the first ?", 8000);
      expect(desk().hintCards().length).toBe(0);
      key({ kind: "esc" });
      await until(() => focusedKind() !== "keys", "closed");
    } finally { cols = 177; rows = 60; }
  });

  test("Conflicts says how many keys really fight, and none of the built-in ones do", async () => {
    key(char("?"));
    await until(() => focusedKind() === "keys", "the keys tile");
    await act("keys.filter", { text: "" });
    await act("keys.tab", { tab: "conflicts" });
    expect(keysWin().rows).toBe(0);
    expect(keysPane().render(44, 30, true, desk()).lines.map(visible).join("\n")).toContain("Conflicts 0");
    key({ kind: "esc" });
    await until(() => focusedKind() !== "keys", "closed");
  });

  test("? opens the keys window on where you are; a rebind by keys is said first, then saved, and the ^W keys follow", async () => {
    const realFlash = app.flash.bind(app);
    (app as any).flash = (m: string, ...r: any[]) => { flashes.push(m); return realFlash(m, ...r); };
    key(char("?"));
    await until(() => focusedKind() === "keys", "the keys window by ?", 8000);
    expect(keysWin().filter).toStartWith("in:");
    // Filter for closing a tile, pick its ^W row.
    await act("keys.filter", { text: "tile.close ^W" });
    const found: any = await act("keys.find", {});
    const n = found.bindings.findIndex((b: any) => b.key === "ctrl+w x") + 1;
    expect(n).toBeGreaterThan(0);
    await act("keys.select", { n });
    expect(lines().join("\n")).toContain("runs     tile.close");
    // r, then the new key: ^W q. What it would do is said before anything is saved.
    key(char("r"));
    await until(() => keysWin().record?.id === "tile.close", "waiting for the key");
    key(char("w", true)); key(char("q"));
    await until(() => keysWin().record?.key === "ctrl+w q", "the new key read");
    expect(lines().join("\n")).toContain("^W x → ^W q");
    expect(existsSync(keymapPath()) && file()["tile.close"]).toBeFalsy();
    key({ kind: "enter" });
    await until(() => existsSync(keymapPath()) && file()["tile.close"]?.includes("ctrl+w q"), "saved in the keymap");
    expect(keysWin().said).toContain("^W x → ^W q");
    // Only ^W x moved: the board's x and a dock's esc q still close (the entry lists every key it keeps).
    expect(asTyped("x", () => moved("tile.close", {}, declaredOf("tile.close")))).toBeNull();
    expect(asTyped("ctrl+w x", () => moved("tile.close", {}, declaredOf("tile.close")))).toContain("no longer runs tile.close");
    // The ^W table follows: q closes, x does nothing; the panel's row says q.
    expect(wKey("q")?.action).toBe("tile.close");
    expect(wKey("x")).toBeUndefined();
    key(char("q"));
    await until(() => focusedKind() !== "keys", "the keys tile closed");
    expect(desk().wRows().find((r: any) => r.action === "tile.close")?.key).toBe("q");
    const before = tiles();
    key(char("w", true)); key(char("q"));
    await until(() => tiles() === before - 1, "^W q closed a tile");
    // ^W x now says where it went, and closes nothing.
    key(char("w", true)); key(char("x"));
    await until(() => flashes.some(f => f.includes("^W x no longer runs tile.close: your keymap gives it ^W q")), "^W x said");
    expect(tiles()).toBe(before - 1);
    // ctrl+z in the window undoes it: the file is as it was.
    await shell("keys.open", {});
    await until(() => focusedKind() === "keys", "the window again");
    key(char("z", true));
    await until(() => !file()["tile.close"], "undone");
    expect(wKey("x")?.action).toBe("tile.close");
    key(char("q"));
    await until(() => focusedKind() !== "keys", "the keys tile closed");
  });

  test("an agent rebinds a key matched in code: the hint row says the new key, the old one says where it went", async () => {
    await shell("keys.open", { filter: "note.new" });
    await until(() => focusedKind() === "keys", "the window");
    const r: any = await app.act({ action: "keys.rebind", args: { id: "note.new", key: "ctrl+n", to: "alt+n" }, tile: "keys", as: "agent:keys-test" });
    expect(r).toMatchObject({ saved: true, id: "note.new", to: "alt+n" });
    // Its other built-in key (+ on the menu) stays; only ctrl+n moved.
    expect(file()["note.new"]).toEqual(["hyper+n", "+", "alt+n"]);
    key(char("q"));
    await until(() => focusedKind() !== "keys", "the keys tile closed");
    const hint = () => visible(desk().render(desk().ctx).lines.at(-1) ?? "");
    await until(() => hint().includes("alt+n new"), "the hint row's new key");
    expect(hint()).not.toContain("^N new");
    // ctrl+n is refused, saying where it went; alt+n opens a new note.
    flashes.length = 0;
    key(char("n", true));
    await until(() => flashes.some(f => f.includes("^N no longer runs note.new")), "the old key said");
    const ran: string[] = [];
    const stop = traceActions(x => ran.push(x.name));
    key({ kind: "alt", ch: "n" });
    await until(() => ran.includes("note.new"), "alt+n ran note.new");
    stop();
    await shell("keys.open", {});
    await until(() => focusedKind() === "keys", "the window");
    await act("keys.reset", { id: "note.new" });
    expect(file()["note.new"]).toBeUndefined();
    // An action with a key after another key (alt+l then s) moves its own key and writes a file that reads clean.
    await act("keys.rebind", { id: "tile.link", key: "alt+l", to: "alt+k" });
    expect(file()["tile.link"]).toContain("alt+k");
    expect(keymapProblem()).toBeNull();
    await act("keys.reset", { id: "tile.link" });
  });

  test("at 40 columns the list sits over the detail and every tab still shows", async () => {
    await shell("keys.open", {});
    await until(() => focusedKind() === "keys", "the window");
    cols = 40; rows = 30;
    try {
      const l = keysPane().render(40, 30, true, desk()).lines.map(visible) as string[];
      expect(l[0]).toContain("Bindings");
      expect(l.join("\n")).toContain("runs");
      expect(l.slice(0, 2).join(" ")).toContain("Conflicts 0");
      expect(Math.max(...l.map(x => x.length))).toBeLessThanOrEqual(40);
      // No tab label and no key is cut mid-word: the tabs wrap, the key column is as wide as its widest key.
      expect(l.slice(0, 2).join(" ")).not.toContain("…");
      const p = keysPane();
      for (const words of ["shift+tab", "ctrl+space", "delete"]) {
        p.filter = words; p.at = 0;
        const rows = p.render(40, 30, true, desk()).lines.map(visible) as string[];
        const caps = rows.slice(4).filter(x => /^[║│]?.?\S/.test(x)).map(x => x.slice(0, 14));
        expect(caps.filter(c => c.includes("…"))).toEqual([]);
      }
      p.filter = "";
      // A mouse gesture with a modifier (ctrl+wheel) is a gesture, never a key row.
      expect(bindings().some(b => /wheel|click|drag/.test(b.key))).toBe(false);
    } finally { cols = 177; rows = 60; }
    key({ kind: "esc" });
    await until(() => focusedKind() !== "keys", "closed");
  });

  test("at 40 columns ? opens the keys tile below, the screen's width, never a strip beside (PIE-1425)", async () => {
    cols = 40; rows = 50;
    try {
      lines();
      const before = tiles();
      key(char("?"));
      await until(() => tiles() === before + 1 && focusedKind() === "keys", "the keys tile", 8000);
      lines();
      const id = [...desk().panes.entries()].find(([, p]: any) => p.kind === "keys")![0];
      expect(desk().placed.rects.get(id).cols).toBeGreaterThanOrEqual(36);
      // The selected row's sentence is said whole under the list, wrapped, where the list's row is cut.
      const long = bindings().find(b => b.key && b.does.length > 45)!;
      await act("keys.filter", { text: long.id });
      const found: any = await act("keys.find", {});
      await act("keys.select", { n: found.bindings.findIndex((b: any) => b.key === long.key && b.id === long.id) + 1 });
      const said = (keysPane().render(40, 50, true, desk()).lines.map(visible) as string[]).map(l => l.replace(/^[║│]\s*|\s*[║│█]$/g, "").trim()).join(" ");
      expect(said.replace(/\s+/g, " ")).toContain(long.does);
      key({ kind: "esc" });
      await until(() => tiles() === before, "esc closed it");
    } finally { cols = 177; rows = 60; lines(); }
  });

  test("at 44 and 40 columns rows that differ in their last words keep them, and the hint row keeps esc (PIE-1439)", async () => {
    await import("../src/river/column");
    await shell("keys.open", {});
    await until(() => focusedKind() === "keys", "the window");
    try {
      const p = keysPane();
      p.filter = "in:river tile.focus"; p.at = 0;
      for (const w of [44, 40]) {
        const l = (p.render(w, 30, true, desk()).lines.map(visible) as string[]).join("\n");
        expect(l, `left at ${w}`).toMatch(/…\s*left/);
        expect(l, `right at ${w}`).toMatch(/…\s*right/);
        expect(fitHint(p.hint(), w - 4).text, `the hint row at ${w}`).toContain("esc");
      }
      p.filter = "";
    } finally { key({ kind: "esc" }); }
    await until(() => focusedKind() !== "keys", "closed");
  });
  test("a rebind by keys reads the key a layer over the screen would take (the glass's alt+u), says who keeps it first, and Conflicts lists it (PIE-1688)", async () => {
    const { runningModules, useDoorModules } = await import("../src/door-modules");
    if (!runningModules().some(([n]) => n === "glass")) useDoorModules(["glass"]);
    const glassMode = () => (runningModules().find(([n]) => n === "glass")![1].describe!() as { mode: string }).mode;
    const mode = glassMode();
    const realFlash = app.flash.bind(app), said: string[] = [];
    (app as any).flash = (m: string, ...r: any[]) => { said.push(m); return realFlash(m, ...r); };
    try {
      await shell("keys.open", {});
      await until(() => focusedKind() === "keys", "the window");
      await act("keys.filter", { text: "draft.clear" });
      const found: any = await act("keys.find", {});
      await act("keys.select", { n: found.bindings.findIndex((b: any) => b.key === "ctrl+u") + 1 });
      key(char("r"));
      await until(() => keysWin().record?.id === "draft.clear", "waiting for the key");
      // alt+u reaches the recording window, never the glass: its mode stays as it was.
      key({ kind: "alt", ch: "u" });
      await until(() => keysWin().record?.key === "alt+u", "alt+u recorded");
      expect(glassMode()).toBe(mode);
      const pane = () => (keysPane().render(160, 40, true, desk()).lines.map(visible) as string[]).join("\n");
      expect(pane()).toContain("glass.toggle (glass) still gets alt+u first");
      // A key even the window's own table binds (j, q) is the new key while it records.
      key(char("q"));
      await until(() => keysWin().record?.key === "q", "q recorded, the window still open");
      key({ kind: "alt", ch: "u" });
      await until(() => keysWin().record?.key === "alt+u", "alt+u again");
      key({ kind: "enter" });
      await until(() => file()["draft.clear"]?.includes("alt+u"), "saved");
      expect(keysWin().said).toContain("glass.toggle gets alt+u first");
      await act("keys.tab", { tab: "conflicts" });
      expect(keysWin().rows).toBe(2);
      expect(pane()).toMatch(/conflict +the door module layer \(glass\) reads alt\+u/);
      // An agent's rebind answers the same: what keeps the key first.
      await act("keys.reset", { id: "draft.clear" });
      const r: any = await app.act({ action: "keys.rebind", args: { id: "draft.clear", key: "ctrl+u", to: "alt+u" }, tile: "keys", as: "agent:keys-test" });
      expect(r.still).toContain("glass.toggle");
      // A key a legacy terminal can't send is saved but said, never "free here".
      const s: any = await app.act({ action: "keys.rebind", args: { id: "draft.clear", key: "alt+u", to: "alt+[" }, tile: "keys", as: "agent:keys-test" });
      expect(s.sends).toContain("Kitty keyboard protocol");
      // A binding that had no key says so, never "null" (CodeRabbit on #1410).
      await app.act({ action: "keys.rebind", args: { id: "share.list", to: "alt+n" }, tile: "keys", as: "agent:keys-test" });
      await until(() => said.some(m => m.includes("no key → alt+n: share.list")), `the save said (${said.join(" | ")})`);
      expect(said.some(m => m.includes("null"))).toBe(false);
    } finally {
      // The keymap and the window as they were, whatever failed above.
      (app as any).flash = realFlash;
      writeFileSync(keymapPath(), "{}\n");
      reloadKeymap();
      if (keysPane()) {
        await act("keys.cancel", {}).catch(() => {});
        await act("keys.tab", { tab: "bindings" }).catch(() => {});
        await act("keys.close", {}).catch(() => {});
        await until(() => focusedKind() !== "keys", "closed");
      }
    }
  });

  test("an old key in a line field says where its action went on the status bar: ^W and esc in the rename prompt (PIE-1688)", async () => {
    writeFileSync(keymapPath(), JSON.stringify({ "draft.erase to=word-back": ["alt+e"], "edit.close": ["alt+q"] }));
    reloadKeymap();
    const realFlash = app.flash.bind(app);
    (app as any).flash = (m: string, ...r: any[]) => { flashes.push(m); return realFlash(m, ...r); };
    try {
      if (!tiles()) await shell("keys.open", {});
      flashes.length = 0;
      key(char("w", true)); key(char("n"));
      await until(() => lines().join("\n").includes("Rename this tile"), "the rename prompt");
      for (const ch of "plum tree") key(char(ch));
      key(char("w", true));
      await until(() => flashes.some(f => f.includes("^W no longer runs draft.erase to=word-back: your keymap gives it alt+e")), `the old ^W said (${flashes.join(" | ")})`);
      key({ kind: "esc" });
      await until(() => flashes.some(f => f.includes("esc no longer closes") && f.includes("alt+q")), "the old esc said");
      expect(screen().holdsKeys?.()).toBe(true);
      key({ kind: "alt", ch: "q" });
      await until(() => !screen().holdsKeys?.(), "alt+q closed it");
      // The facets query line follows edit.close too: its hint names alt+q, and the old esc says so.
      await desk().dispatch.act({ action: "tile.open", args: { kind: "facets" } }, USER);
      await until(() => focusedKind() === "facets", "a facets tile");
      key(char("e"));
      await until(() => !!screen().holdsKeys?.(), "the query line");
      flashes.length = 0;
      key({ kind: "esc" });
      await until(() => flashes.some(f => f.includes("esc no longer closes the query: your keymap gives it alt+q")), `the old esc said (${flashes.join(" | ")})`);
      key({ kind: "alt", ch: "q" });
      await until(() => !screen().holdsKeys?.(), "alt+q closed the query");
    } finally {
      writeFileSync(keymapPath(), "{}\n");
      reloadKeymap();
    }
  });

  // PIE-1719: what a rebind says reads at 44 columns and in a 42-column keys tile, without widening anything.
  test("at 44 columns the old key's sentence is drawn whole above the bar, and a way out with a suffix reads as a sentence (PIE-1719)", async () => {
    writeFileSync(keymapPath(), JSON.stringify({ "edit.close": ["alt+q"] }));
    reloadKeymap();
    cols = 44; rows = 24;
    try {
      const note = await board.createBlock(null, "Seed swap\n\nTomatoes for beans.\n");
      await desk().dispatch.act({ action: "tile.open", args: { kind: "reader", id: note.id, name: "swap" } }, USER);
      await desk().dispatch.act({ action: "tile.focus", tile: "swap" }, USER);
      // The reader alone on the 44-column screen, whatever the tests before left open.
      await desk().dispatch.act({ action: "tile.zoom", tile: "swap" }, USER);
      await until(() => frame().join("\n").includes("Tomatoes"), "the note").catch(e => { throw new Error(`${e.message}:\n${frame().join("\n")}`); });
      key(char("C"));
      await until(() => frame().join("\n").includes("alt+q"), "the composer, its way out alt+q").catch(e => { throw new Error(`${e.message}:\n${frame().join("\n")}`); });
      for (const ch of "more beans") key(char(ch));
      // The composer's own foot names the key its way out is now, not esc (wide enough to read the foot).
      cols = 177;
      expect(frame().join("\n")).toContain("alt+q twice puts comment aside");
      expect(frame().join("\n")).not.toContain("esc twice puts comment aside");
      cols = 44;
      key({ kind: "esc" });
      // Above the bar, whole (wrapped): what esc no longer does to the comment, its way out's words kept apart from it.
      const said = () => frame().slice(-6, -1).map(l => l.trim()).join(" ").replace(/\s+/g, " ");
      await until(() => said().includes("alt+q"), `the old esc said above the bar (${said()})`);
      expect(said()).toContain("esc no longer closes the comment (twice puts it aside): your keymap gives it alt+q");
      key({ kind: "alt", ch: "q" }); key({ kind: "alt", ch: "q" });
      await until(() => !frame().join("\n").includes("more beans"), "alt+q twice put it aside");
      await desk().dispatch.act({ action: "tile.close", tile: "swap" }, USER);
    } finally {
      cols = 177; rows = 60;
      writeFileSync(keymapPath(), "{}\n");
      reloadKeymap();
    }
  });

  test("in a 42×23 keys tile the rebind's preview is in view first, whole: who still gets the key (PIE-1719)", async () => {
    const { runningModules, useDoorModules } = await import("../src/door-modules");
    if (!runningModules().some(([n]) => n === "glass")) useDoorModules(["glass"]);
    try {
      await shell("keys.open", {});
      await until(() => focusedKind() === "keys", "the window");
      await act("keys.filter", { text: "draft.clear" });
      const found: any = await act("keys.find", {});
      await act("keys.select", { n: found.bindings.findIndex((b: any) => b.key === "ctrl+u") + 1 });
      key(char("r"));
      await until(() => keysWin().record?.id === "draft.clear", "waiting for the key");
      key({ kind: "alt", ch: "u" });
      await until(() => keysWin().record?.key === "alt+u", "alt+u recorded");
      // The tile's inside at 42×23 (its frame takes a column each side and its title and foot rows).
      for (const [w, h] of [[40, 21], [42, 23]] as const) {
        const drawn = (keysPane().render(w, h, true, desk()).lines.map(visible) as string[]).map(l => l.trim()).join(" ").replace(/\s+/g, " ");
        expect(drawn, `at ${w}×${h}`).toContain("^U → alt+u");
        expect(drawn, `at ${w}×${h}`).toContain("glass.toggle (glass) still gets alt+u first");
        expect(drawn, `at ${w}×${h}`).toContain("⏎ save");
      }
    } finally {
      await act("keys.cancel", {}).catch(() => {});
      writeFileSync(keymapPath(), "{}\n");
      reloadKeymap();
      await act("keys.close", {}).catch(() => {});
      await until(() => focusedKind() !== "keys", "closed");
    }
  });

  test("? on a desk with no tiles opens the keys window, with no error", async () => {
    for (const id of [...desk().tiles()]) await desk().dispatch.act({ action: "tile.close", args: {}, tile: desk().nameOf(id.id ?? id) }, USER).catch(() => {});
    await until(() => tiles() === 0, "an empty desk");
    await shell("keys.open", {});
    await until(() => tiles() === 1 && focusedKind() === "keys", "the keys tile on the empty desk");
  });
});

test("? on a river column opens on the river's keys, its h l x p among them; in an edit, the note's (PIE-1425)", async () => {
  const { RiverColumn } = await import("../src/river/column");
  const { matches } = await import("../src/desk/keys-window");
  const library = new RiverColumn({ kind: "roots" } as any);
  expect(library.keysScope()).toBe("river");
  const shown = bindings().filter(b => matches(b, `in:${library.keysScope()}`));
  for (const action of ["tile.focus", "tile.close", "tile.hold"]) expect(shown.some(b => b.action === action && b.scope === "river column")).toBe(true);
  // Its card moves (K J I O) too, and nothing of another place named alike (`in:status` isn't the status bar's).
  expect(shown.some(b => b.action === "column.move")).toBe(true);
  expect(bindings().filter(b => matches(b, "in:status")).every(b => b.scope === "status")).toBe(true);
  expect(shown.some(b => b.scope === "note")).toBe(false);
});

test("in the river, what takes a key first is what the river runs: nothing the main menu's letters say; ^W chords are listed in:river (PIE-1439)", async () => {
  await import("../src/river/column");
  const { matches } = await import("../src/desk/keys-window");
  const { shadowsOf } = await import("../src/surface/key-catalog");
  const all = bindings();
  const river = all.filter(b => matches(b, "in:river"));
  // x, h, w and I in a river column are its own: a menu letter works only on the main menu, so it takes none of them.
  for (const key of ["x", "h", "w", "l", "I"]) {
    const b = river.find(r => r.key === key);
    expect(b, `the river's ${key}`).toBeDefined();
    expect(shadowsOf(b!, all).over.map(o => `${o.id} (${o.scope})`), `what takes ${key} first`).toEqual([]);
  }
  // The menu's letters say where they work: the menu.
  const letter = all.find(b => b.action === "screen.open" && b.key === "x")!;
  expect(letter.scope).toBe("menu");
  expect(matches(letter, "in:menu")).toBe(true);
  // A key that truly works on every screen still says what it takes: alt+v over a tile's own alt+v, if any, is the App's.
  expect(all.find(b => b.action === "video.cycle" && b.key === "alt+v")!.layer).toBe("every screen");
  // The ^W chords work in a river, a screen of tiles: in:river lists them.
  expect(river.some(b => b.key === "ctrl+w x" && b.action === "tile.close")).toBe(true);
  // Conflicts agree: no fight is found where no "taken by" is said.
  expect(conflicts(all)).toEqual([]);
});
