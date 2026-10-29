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
import { visible } from "../src/style";
import { bindings, rebindEffects } from "../src/surface/key-catalog";
import { declaredOf, effective, keymapEntries, keymapProblem, resetKeys, keymapPath, moved, asTyped, parse, reloadKeymap, setKeys, undoKeymap } from "../src/surface/keymap";
import type { Key } from "../src/term";
import { traceActions } from "../src/surface/actions";
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
  let cols = 177, rows = 60;
  const screen = () => (app as any).stack.at(-1) as any;
  const lines = () => screen().render(screen().ctx).lines.map(visible) as string[];
  const keysWin = () => screen().describe().tiles?.find?.((t: any) => t.keys)?.keys ?? screen().describe().keys;
  const act = (action: string, args: Record<string, unknown> = {}, as?: string) => (as ? app.act({ action, args, as }) : screen().dispatch.act({ action, args }, USER));

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    delete process.env.EP0CH_KEYMAP;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { get cols() { return cols; }, get rows() { return rows; }, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
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

  test("? opens the keys window on where you are; a rebind by keys is said first, then saved, and the ^W keys follow", async () => {
    const realFlash = app.flash.bind(app);
    (app as any).flash = (m: string, ...r: any[]) => { flashes.push(m); return realFlash(m, ...r); };
    key(char("?"));
    await until(() => screen().title === "keys", "the keys window by ?", 8000);
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
    expect(existsSync(keymapPath())).toBe(false);
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
    await until(() => screen().spec?.name === "desk", "back on the desk");
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
    await until(() => screen().title === "keys", "the window again");
    key(char("z", true));
    await until(() => !file()["tile.close"], "undone");
    expect(wKey("x")?.action).toBe("tile.close");
    key(char("q"));
    await until(() => screen().spec?.name === "desk", "back on the desk");
  });

  test("an agent rebinds a key matched in code: the hint row says the new key, the old one says where it went", async () => {
    await shell("keys.open", { filter: "note.new" });
    await until(() => screen().title === "keys", "the window");
    const r: any = await app.act({ action: "keys.rebind", args: { id: "note.new", key: "ctrl+n", to: "alt+n" }, tile: "keys", as: "agent:keys-test" });
    expect(r).toMatchObject({ saved: true, id: "note.new", to: "alt+n" });
    // Its other built-in key (+ on the menu) stays; only ctrl+n moved.
    expect(file()["note.new"]).toEqual(["hyper+n", "+", "alt+n"]);
    key(char("q"));
    await until(() => screen().spec?.name === "desk", "back on the desk");
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
    await until(() => screen().title === "keys", "the window");
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
    await until(() => screen().title === "keys", "the window");
    cols = 40; rows = 30;
    try {
      const l = lines();
      expect(l[1]).toContain("Bindings");
      expect(l.join("\n")).toContain("runs");
      expect(Math.max(...l.map(x => x.length))).toBeLessThanOrEqual(40);
    } finally { cols = 177; rows = 60; }
  });
});
