// PIE-699: bare - and + fold and unfold the focused tile to a spine, and an optional hyper layer (⌃⌥⇧⌘, Kitty modifiers
// 15) reaches the door's actions from anywhere, even while typing. The reports are injected as the bytes a terminal
// sends (CSI 107;16u, xterm's modifyOtherKeys form); the desk runs against a scratch outliner service with fictional notes.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { describeKey, modsOf, showBytes } from "../src/key-probe";
import { HYPER_KEYS, hyperBinding, hyperKeysOf, hyperOn, useHyper } from "../src/hyper";
import { parseReport, reportKey } from "../src/kbd";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { KeyDecoder, type Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const info = { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false };
/** What a decoder makes of the bytes a terminal sent. */
function decode(bytes: string, sink?: string[]): Key[] {
  const out: Key[] = [], d = new KeyDecoder(info as any);
  d.keyHandler = k => out.push(k);
  if (sink) d.rawSink = () => (s: string) => { sink.push(s); };
  d.feed(bytes);
  return out;
}

afterEach(() => { useHyper(null); delete process.env.EP0CH_HYPER; });

describe("hyper chords as a terminal sends them", () => {
  test("off (the default), ⌃⌥⇧⌘ and a key is what it always was: super with the key; nothing is hyper", () => {
    expect(hyperOn()).toBe(false);
    expect(decode("\x1b[107;16u")).toEqual([{ kind: "super", ch: "K" }]);
  });

  test("on, the Kitty report with modifiers 15 is hyper, whatever shift made of the key", () => {
    useHyper(true);
    expect(decode("\x1b[107;16u")).toEqual([{ kind: "hyper", ch: "k" }]);                 // ✦k
    expect(decode("\x1b[107:75;16u")).toEqual([{ kind: "hyper", ch: "k" }]);              // with the alternate keys flag
    expect(decode("\x1b[61:43;16u")).toEqual([{ kind: "hyper", ch: "=" }]);               // ✦= (shift makes it +; the base key is =)
    expect(decode("\x1b[45;16u")).toEqual([{ kind: "hyper", ch: "-" }]);
    expect(decode("\x1b[49;16u")).toEqual([{ kind: "hyper", ch: "1" }]);
    expect(decode("\x1b[107;80u")).toEqual([{ kind: "hyper", ch: "k" }]);                 // caps lock (64) is held too
    expect(decode("\x1b[107;16:3u")).toEqual([]);                                        // a release is nothing
    expect(decode("\x1b[27;16;107~")).toEqual([{ kind: "hyper", ch: "k" }]);              // xterm's modifyOtherKeys form (tmux, Herdr)
    expect(decode("\x1b[57401;16u")).toEqual([{ kind: "hyper", ch: "2" }]);               // keypad 2
  });

  test("on, a chord with fewer modifiers is not hyper: ⌃⌥⇧ is ctrl+alt+shift, ⌘ alone is super", () => {
    useHyper(true);
    expect(decode("\x1b[107;8u")).toEqual([{ kind: "char", ch: "k", ctrl: true, shift: true }]);   // ctrl+alt+shift
    expect(decode("\x1b[107;9u")).toEqual([{ kind: "super", ch: "k" }]);
    expect(decode("\x1b[27;16;13~")).not.toContainEqual({ kind: "hyper", ch: "\r" });             // ⏎, esc and the like are never hyper
  });

  test("EP0CH_HYPER wins over the setting, either way", () => {
    useHyper(true);
    process.env.EP0CH_HYPER = "0";
    expect(hyperOn()).toBe(false);
    useHyper(false);
    process.env.EP0CH_HYPER = "1";
    expect(hyperOn()).toBe(true);
    expect(decode("\x1b[104;16u")).toEqual([{ kind: "hyper", ch: "h" }]);
  });

  test("in a terminal tile (raw input) a hyper chord stays the door's and every other report goes to the program", () => {
    useHyper(true);
    const sink: string[] = [];
    expect(decode("\x1b[107;16u", sink)).toEqual([{ kind: "hyper", ch: "k" }]);
    expect(sink).toEqual([]);
    const sent: string[] = [];
    expect(decode("\x1b[107;5u", sent)).toEqual([]);                                     // ctrl+k is the program's
    expect(sent).toEqual(["\x1b[107;5u"]);
    useHyper(false);
    const off: string[] = [];
    expect(decode("\x1b[107;16u", off)).toEqual([]);                                     // off: the program gets it as before
    expect(off).toEqual(["\x1b[107;16u"]);
  });

  test("the decoder keeps the bytes of the key just read (keys.probe shows them)", () => {
    const d = new KeyDecoder(info as any);
    d.keyHandler = () => {};
    d.feed("\x1b[107;16u"); expect(d.lastSeq).toBe("\x1b[107;16u");
    d.feed("\x1bx"); expect(d.lastSeq).toBe("\x1bx");
    d.feed("a"); expect(d.lastSeq).toBe("a");
    d.feed("\x1b[1;3D"); expect(d.lastSeq).toBe("\x1b[1;3D");
  });

  test("the probe line: bytes, modifiers, what the door read, and why a chord is super when the layer is off", () => {
    expect(showBytes("\x1b[107;16u")).toBe("CSI 107;16u");
    expect(modsOf("\x1b[107;16u")).toBe("⌃⌥⇧⌘");
    expect(modsOf("\x1b[99;9u")).toBe("⌘");
    expect(modsOf("a")).toBeNull();
    const off = describeKey(reportKey(parseReport("\x1b[107;16u")!)!, "\x1b[107;16u");
    expect(off).toContain("bytes CSI 107;16u");
    expect(off).toContain("modifiers ⌃⌥⇧⌘");
    expect(off).toContain("the layer is off");
    useHyper(true);
    const on = describeKey(reportKey(parseReport("\x1b[107;16u")!)!, "\x1b[107;16u");
    expect(on).toContain("hyper+k (✦k, the hyper layer)");
    expect(describeKey({ kind: "char", ch: "a" }, "a")).toContain("legacy (no key report");
  });
});

describe("the keymap", () => {
  test("one binding per chord, each an action the door has, with its other keys named", () => {
    expect(new Set(HYPER_KEYS.map(b => b.key)).size).toBe(HYPER_KEYS.length);
    expect(hyperBinding("+")).toBe(hyperBinding("="));                                    // + is = with shift
    expect(hyperKeysOf("tile.collapse")).toEqual(["✦-", "✦="]);
    const grammar = readFileSync(join(import.meta.dir, "../docs/UI-GRAMMAR.md"), "utf8");
    for (const b of HYPER_KEYS) expect(grammar).toContain(`✦${b.key}`);
  });
});

describe.skipIf(!outliner)("bare - + = on the desk, and the hyper layer, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk, key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { focus: string; tiles: any[] };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const names = () => get().tiles.map((t: any) => t.name as string);
  const focus = (name: string) => { void D().dispatch.act({ action: "tile.focus", tile: name }, { kind: "user" }); };
  const reader = () => D().panes.get(D().focus) as ReaderPane;
  const message = () => ((app as any).message ?? "") as string;
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "agent" })).id as string;
  /** The person in the edit of a fresh note. */
  async function editing(text: string) {
    const id = await create(text);
    desk.openBlock((await board.get(id))!);
    desk.focusOn("reader");
    await until(() => reader()?.msg?.id === id && !reader().msg!.partial, "the reader to show the note");
    const rd = reader();
    key(char("e"));
    await until(() => !!rd.draft, "the draft");
    return { id, rd, name: D().nameOf(D().focus) as string };
  }
  const idle = () => { for (const k of [{ kind: "esc" }, { kind: "esc" }] as Key[]) key(k); };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(() => {});
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    render();
  }, 30_000);
  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k];
  });

  test("- folds the focused tile to a spine, + and = open it, and on a spine any of the three opens it", () => {
    const t = names().find(n => !tile(n).typing)!;
    focus(t);
    key(char("-"));
    expect(tile(t).collapsed).toBe(true);
    key(char("+"));
    expect(tile(t).collapsed).toBeUndefined();
    key(char("-"));
    expect(tile(t).collapsed).toBe(true);
    key(char("="));
    expect(tile(t).collapsed).toBeUndefined();
    key(char("-"));
    key(char("-"));                                                                      // on a spine - toggles it open too
    expect(tile(t).collapsed).toBeUndefined();
    key(char("+"));                                                                      // + on an open tile: nothing to open, nothing said
    expect(tile(t).collapsed).toBeUndefined();
    expect(get().focus).toBe(t);
  });

  test("while the person types - + = are text: a draft takes them, and folds nothing", async () => {
    const { rd, name } = await editing("Prune the plum\nin winter");
    for (const c of "a-b+c=d") key(char(c));
    expect(rd.draft!.lines.join("\n")).toContain("a-b+c=d");
    expect(tile(name).collapsed).toBeUndefined();
    idle();
    await until(() => !rd.draft, "the edit closed");
  }, 30_000);

  test("a tile's own - + = win: the tune inspector nudges instead of folding", async () => {
    await D().dispatch.act({ action: "tile.tune", tile: names().find((n: string) => n.startsWith("reader")) ?? names()[0] }, { kind: "user" });
    const tune = names().find(n => n.startsWith("tune"));
    expect(tune).toBeDefined();
    expect(get().focus).toBe(tune!);
    key(char("-")); key(char("+")); key(char("="));
    expect(tile(tune!).collapsed).toBeUndefined();
    expect(get().tiles.filter((t: any) => t.collapsed)).toEqual([]);
    void D().dispatch.act({ action: "tile.close", tile: tune }, { kind: "user" });
  }, 30_000);

  test("off, a hyper chord does nothing to the desk (a terminal tile gets it as before); keys.probe describes the next chord and runs none", async () => {
    const t = names()[0]!;
    focus(t);
    key({ kind: "super", ch: "-" });
    expect(tile(t).collapsed).toBeUndefined();
    expect(await app.dispatch.press("keys.probe")).toMatchObject({ probing: true });
    (app as any).term.lastSeq = "\x1b[45;16u";
    key({ kind: "super", ch: "-" });
    expect(message()).toContain("✦ probe");
    expect(message()).toContain("CSI 45;16u");
    key(char("-"));                                                                      // described, not run
    expect(tile(t).collapsed).toBeUndefined();
    key({ kind: "esc" });
    expect(message()).toContain("key probe ended");
    key(char("-"));                                                                      // run again
    expect(tile(t).collapsed).toBe(true);
    key(char("-"));
  });

  test("hyper.set keeps the layer on for the next start, and EP0CH_HYPER=0 says it wins", async () => {
    expect(await app.dispatch.press("hyper.set", { on: true })).toMatchObject({ on: true });
    expect(hyperOn()).toBe(true);
    expect(JSON.parse(readFileSync(join(scratch.root, "door", "hyper.json"), "utf8"))).toEqual({ on: true });
    process.env.EP0CH_HYPER = "0";
    expect(await app.dispatch.press("hyper.set", { on: true })).toMatchObject({ on: false, saved: true });
    expect(message()).toContain("EP0CH_HYPER is set and wins");
    delete process.env.EP0CH_HYPER;
  });

  test("on, ✦- and ✦= fold and open the focused tile, and ✦h j k l and ✦1-9 move the keys", () => {
    useHyper(true);
    const t = names()[0]!;
    focus(t);
    key({ kind: "hyper", ch: "-" });
    expect(tile(t).collapsed).toBe(true);
    key({ kind: "hyper", ch: "=" });
    expect(tile(t).collapsed).toBeUndefined();
    key({ kind: "hyper", ch: "2" });
    expect(get().focus).toBe(D().nameOf(D().all()[1]));
    key({ kind: "hyper", ch: "1" });
    expect(get().focus).toBe(D().nameOf(D().all()[0]));
    key({ kind: "hyper", ch: "z" });
    expect(D().zoom).not.toBeNull();
    key({ kind: "hyper", ch: "z" });
    expect(D().zoom).toBeNull();
    key({ kind: "hyper", ch: "q" });
    expect(message()).toContain("✦q isn't bound");
  });

  test("on, ✦- works while typing in a draft (the draft is kept on the spine), and ✦l leaves the edit as a click elsewhere does", async () => {
    useHyper(true);
    const { id, rd, name } = await editing("Mend the cold frame\nlid");
    for (const c of " today") key(char(c));
    key({ kind: "hyper", ch: "-" });
    expect(tile(name).collapsed).toBe(true);
    expect(rd.draft).not.toBeNull();                                                     // folded, not closed: the draft is exactly as it was
    expect(rd.draft!.lines.join("\n")).toContain("today");
    key({ kind: "hyper", ch: "=" });
    expect(tile(name).collapsed).toBeUndefined();
    key({ kind: "hyper", ch: "h" });                                                     // the tile to its left: the edit is left first, saved, as a click elsewhere leaves it
    expect(get().focus).not.toBe(name);
    await until(() => !rd.draft, "the edit left and saved");
    expect((await board.get(id))!.text).toContain("today");
  }, 30_000);

  test("every hyper binding is an action the door has (so each is also a key, a click and act)", () => {
    for (const b of HYPER_KEYS) expect(app.dispatch.has(b.action) || D().dispatch.has(b.action)).toBe(true);
  });
});
