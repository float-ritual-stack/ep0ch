// The review of #49 (tiles and the agent interface): each finding and its test. Agents never take the person's
// keys (one guard; focus, pane.* and open are the same actions as tile.*); leaving the desk keeps its programs;
// closing a running program asks twice; an exited program's tile holds the keys until a choice; a screen tile
// in an edit keeps the desk's keys; raw input, pastes, F-keys and a literal ctrl+] reach programs; the live feed
// is throttled and lets a stalled subscriber go; an agent never moves the outline's cursor; state is written
// whole. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { App } from "../src/app";
import { feedWriter } from "../src/control";
import { Desk } from "../src/desk/desk";
import { normalise, revive } from "../src/desk/layout";
import { NvimClient, nvimSocketPath } from "../src/desk/nvim";
import { Goodbye, MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { readState, writeState } from "../src/state";
import { Term, type Key } from "../src/term";
import { terminalDay } from "./terminal-day";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe("pieces that need no outline", () => {
  test("raw input: every byte to the program but mouse reports and ctrl+], which stay the door's", () => {
    const t = new Term();
    const keys: Key[] = [], raw: string[] = [];
    t.onKey(k => keys.push(k));
    let on = true;
    t.rawSink = () => (on ? (s: string) => raw.push(s) : null);
    (t as any).feed("\x1b[15~\x1b[1;2A\x1b[2~q\x1b[<0;3;4M");
    expect(raw.join("")).toBe("\x1b[15~\x1b[1;2A\x1b[2~q");
    expect(keys).toEqual([{ kind: "mouse", action: "down", button: 0, x: 2, y: 3 }]);
    (t as any).feed("ab\x1dcd");
    expect(raw.join("")).toContain("ab");
    expect(keys.at(-1)).toEqual({ kind: "char", ch: "]", ctrl: true });
    on = false;                                                   // ctrl+] left the terminal: the rest is decoded
    (t as any).feed("x");
    expect(keys.at(-1)).toEqual({ kind: "char", ch: "x" });
    on = true;
    (t as any).feed("\x1b[<0;3");                                 // a mouse report cut short waits for the rest
    expect(raw.join("")).not.toContain("[<0;3");
    (t as any).feed(";4m");
    expect(keys.at(-1)).toMatchObject({ kind: "mouse", action: "up" });
  });

  test("a bracketed paste is one paste key; App types it where a screen doesn't take pastes whole", () => {
    const t = new Term();
    const keys: Key[] = [];
    t.onKey(k => keys.push(k));
    (t as any).feed("\x1b[200~line one\nline two\x1b[201~z");
    expect(keys).toEqual([{ kind: "paste", text: "line one\nline two" }, { kind: "char", ch: "z" }]);
  });

  test("the live feed lets a subscriber go once too much waits unread; otherwise it writes what was asked for", () => {
    const lines: string[] = [];
    let gone = false, off = false;
    const sock = { writableLength: 0, write: (s: string) => lines.push(s), destroy: () => { gone = true; } };
    const w = feedWriter(sock, new Set(["cursor"]), () => { off = true; }, 1000);
    w({ type: "hello" }); w({ type: "viewport" }); w({ type: "cursor" });
    expect(lines.map(l => JSON.parse(l).event.type)).toEqual(["hello", "cursor"]);
    sock.writableLength = 5000;
    w({ type: "cursor" });
    expect([gone, off, lines.length]).toEqual([true, true, 2]);
  });

  test("an empty tab set takes no room; a tree of nothing but empty tab sets is empty", () => {
    const t = normalise(revive({ t: "split", dir: "row", kids: [{ t: "tabs", tabs: [], active: 0 }, { t: "leaf", name: "a" }], weights: [1, 1] } as any, (l: any) => l.name));
    expect(t).toEqual({ t: "leaf", id: "a" });
  });

  test("state is written whole: a temp file renamed over it, none left behind", () => {
    const dir = join(require("node:os").tmpdir(), `ep0ch-state-${process.pid}`);
    const was = process.env.EP0CH_STATE;
    process.env.EP0CH_STATE = dir;
    try {
      writeState("x.json", { jam: 1 });
      writeState("x.json", { jam: 2 });
      expect(readState<any>("x.json")).toEqual({ jam: 2 });
      expect(readdirSync(dir).filter(f => f.includes(".tmp"))).toEqual([]);
    } finally { if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; }
  });

  test("nvim's RPC: a request nobody answers is refused in time; bytes that aren't msgpack don't break the connection", async () => {
    const path = join(require("node:os").tmpdir(), `ep0ch-mute-${process.pid}.sock`);
    const server = createServer(s => { s.write(Buffer.from([0xc1, 0xc1])); });   // never answers; sends junk
    await new Promise<void>(r => server.listen(path, () => r()));
    const c = new NvimClient(path);
    await c.connect(1000);
    await expect(c.request("nvim_get_mode", [], 150)).rejects.toThrow(/didn't answer nvim_get_mode/);
    c.close(); server.close();
  });

  test("nvim's socket folder is the user's own (mode 700), never a shared one", () => {
    const p = nvimSocketPath("draft");
    if (!p) return;                                              // no folder this user owns alone: no socket at all
    const st = require("node:fs").statSync(require("node:path").dirname(p));
    expect(st.mode & 0o077).toBe(0);
    expect(st.uid).toBe(process.getuid!());
  });
});

describe.skipIf(!outliner)("the review's findings, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "reviewer-3";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().dispatch.act({ action, args, tile: reader }, { kind: "user" });
  const tile = (name: string) => (D().layoutGet().tiles as any[]).find(t => t.name === name);
  const idOf = (name: string) => [...D().names].find(([, v]: any) => v === name)![0];
  const message = () => (app as any).message as string;
  const top = () => (app as any).stack.at(-1);
  const render = () => desk.render(D().ctx);
  const enter = (name: string) => { render(); const r = tile(name).rect; key({ kind: "mouse", action: "down", button: 0, x: r.col + 3, y: r.row + 3 }); key({ kind: "mouse", action: "up", button: 0, x: r.col + 3, y: r.row + 3 }); };
  const screenOf = (name: string) => (tile(name).terminal.text as string[]).join("\n");
  const notes: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = join(scratch.root, "door", "draft.md");
    process.env.EDITOR = "tail -f";
    board = new SocketBoard(await scratch.start());
    await board.info();
    notes.shed = await board.request<any>("create", { parentId: null, text: "Mend the shed roof\nFelt and tacks.", author: "agent" });
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: terminalDay() });
    app.push(desk);
    render();
    await until(() => tile("claude")?.terminal?.running, "the agent tile");
  }, 30_000);

  afterAll(async () => {
    D().dispose(); for (const p of D().panes.values()) p.dispose?.();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  test("blocker: while the person types in a terminal, an agent's focus, dock shut and open all leave the keys there", async () => {
    await mine("tile.dock", { on: true }, "side");                 // a dock, to try shutting under them
    enter("claude");
    expect(D().describe().inTerminal).toBe("claude");
    await expect(act("tile.focus", {}, "middle")).rejects.toThrow(/the person is typing/);
    await expect(act("tile.focus", {}, "middle")).rejects.toThrow(/the person is typing/);
    await app.act({ action: "open", args: { id: notes.shed.id } });                             // an agent's `open <id>`
    await until(() => (D().layoutGet().tiles as any[]).some(t => t.showing?.id === notes.shed.id), "the note shown somewhere");
    expect(D().describe().inTerminal).toBe("claude");
    await expect(act("layout.load", { name: "desk" })).rejects.toThrow(/the person is typing/);
    key(ctrl("]"));
    // The dock: the person opens it and types in the preview's… no: they're in it; an agent can't shut it on them.
    await mine("tile.slide", { open: true }, "side");
    expect(D().focus).toBe(idOf("side"));
    D().overlays.push({ name: "layouts", key: () => true, draw() {} }); // typing (a picker counts)
    await expect(act("tile.slide", { open: false }, "side")).rejects.toThrow(/shut the dock they have/);
    D().overlays.drop("layouts");
    await mine("tile.dock", { on: false }, "side");
  });

  test("blocker: pane.split and pane.close are tile.open and tile.close (one path: a split along the same axis joins it)", async () => {
    const before = D().layoutGet().tree;
    const r = await act("pane.split", { kind: "reader", dir: "col" }, "middle") as any;
    expect(r.tile).toBe("reader");
    expect(D().focus).not.toBe(idOf("reader"));                     // an agent's split leaves the keys
    const col = (D().layoutGet().tree.kids as any[]).find(k => k.kids?.some((x: any) => x.pane === "reader"));
    expect(col.kids.map((k: any) => k.pane)).toContain("middle");  // joined the column, not a nested pair
    await act("tile.close", {}, "reader");
    const names = (n: any): string => n.pane ?? `${n.split}(${n.kids.map(names).join(",")})`;
    expect(names(D().layoutGet().tree)).toBe(names(before));
  });

  test("S7: an agent's open never moves the outline's cursor; the person's reveals it", async () => {
    const tree = D().panes.get(idOf("tree"));
    await until(() => tree.rows?.length > 3, "the tree's rows");
    tree.sel = 0;
    await act("open", { id: notes.shed.id }, "middle");
    await Bun.sleep(300);
    expect(tree.sel).toBe(0);
    await mine("open", { id: notes.shed.id }, "middle");
    await until(() => tree.rows[tree.sel]?.m.id === notes.shed.id, "the person's open revealing it");
  });

  test("S2: ^W x on a running program asks; again within 3s closes it", async () => {
    await mine("tile.open", { kind: "pty", cmd: "sh", name: "scratch-sh", where: "right" }, "side");
    await until(() => tile("scratch-sh")?.terminal?.running, "the shell");
    D().focus = idOf("scratch-sh");
    key(ctrl("w")); key(char("x"));
    expect(tile("scratch-sh")).toBeTruthy();
    expect(message()).toContain("again within 3s closes");
    key(ctrl("w")); key(char("x"));
    expect(tile("scratch-sh")).toBeUndefined();
  });

  test("S3: after the program the person types in exits, keys wait for ⏎ or ctrl+]; nothing leaks to the desk", async () => {
    await mine("tile.open", { kind: "pty", cmd: "sh -c 'sleep 0.3'", name: "short", where: "right" }, "side");
    enter("short");
    await until(() => tile("short").terminal.exited !== null, "the program to exit");
    for (const k of [char("/"), char("q"), { kind: "esc" } as Key, char("1"), { kind: "tab" } as Key]) key(k);
    expect(D().overlays.get("search")).toBeNull();
    expect(top()).toBe(desk);
    expect(D().focus).toBe(idOf("short"));
    expect(message()).toContain("exited · ⏎ runs it again · ^W x closes · ctrl+] back to the door");
    key({ kind: "enter" });
    await until(() => tile("short").terminal.running || tile("short").terminal.exited !== null, "restarted");
    key(ctrl("]"));
    D().closeId(idOf("short"));
  });

  test("S5: pastes arrive as one bracketed paste; raw F5, shift-arrow and a doubled ctrl+] reach the program", async () => {
    await mine("tile.open", { kind: "pty", cmd: `sh -c 'printf "\\033[?2004h"; exec cat -v'`, name: "catv", where: "right" }, "side");
    enter("catv");
    await until(() => D().rawInput() !== null && D().panes.get(idOf("catv")).term?.modes.bracketedPasteMode, "raw input on, and the program asking for bracketed pastes");
    key({ kind: "paste", text: "one\ntwo" });
    D().rawInput()!("\x1b[15~\x1b[1;2A");                            // F5, shift+up: as the terminal sent them
    key(ctrl("]")); key(ctrl("]"));                                  // the second one goes to the program
    expect(D().describe().inTerminal).toBe("catv");
    key({ kind: "enter" });
    await until(() => /\^\[\[200~one/.test(screenOf("catv")) && screenOf("catv").includes("^[[15~") && screenOf("catv").includes("^[[1;2A") && screenOf("catv").includes("^]"), "the bytes echoed", 5000);
    expect(screenOf("catv")).toContain("two^[[201~");
    key(ctrl("]"));
    D().closeId(idOf("catv"));
  });

  test("S4: a board tile in its own edit keeps every key: the desk's Tab, ^W and alt keys don't fire", async () => {
    await mine("tile.open", { kind: "board", name: "kanban", where: "right" }, "side");
    const t = D().panes.get(idOf("kanban"));
    const got: Key[] = [];
    t.holdsKeys = () => true; t.key = (k: Key) => { got.push(k); return true; };
    D().focus = idOf("kanban");
    for (const k of [{ kind: "tab" } as Key, ctrl("w"), { kind: "alt", ch: "d" } as Key, char("q")]) key(k);
    expect(got.length).toBe(4);
    expect(D().prefix).toBe("");
    expect(D().layoutName).toBe("terminal-day");
    expect(D().holdsKeys()).toBe(true);
    await expect(act("tile.focus", {}, "middle")).rejects.toThrow(/the person is typing/);
    t.holdsKeys = () => false;
    D().closeId(idOf("kanban"));
  });

  test("S6: an unfocused terminal's cursor stays out of the feed; paints are one a frame", async () => {
    D().focus = idOf("tree");
    const v = D().viewState();
    expect(v.tiles.find((t: any) => t.tile === "claude").cursor).toBeUndefined();
    let renders = 0;
    const real = desk.render.bind(desk);
    (desk as any).render = (c: any) => { renders++; return real(c); };
    await Bun.sleep(40);
    renders = 0;
    for (let i = 0; i < 30; i++) app.redraw();
    expect(renders).toBeLessThanOrEqual(1);                          // at once, unless a frame's paint was already coming
    await Bun.sleep(40);
    expect(renders).toBeGreaterThanOrEqual(1);
    expect(renders).toBeLessThanOrEqual(2);                          // 30 calls, at most one more at the frame's end
    (desk as any).render = real;
  });

  test("S8: desk.json is written once for a border drag, on release", async () => {
    render();
    const f = join(scratch.root, "door", "desk.json");
    const before = readFileSync(f, "utf8");
    const d = D().dividers.find((x: any) => x.node === D().root);
    const y = d.area.row + 5;
    key({ kind: "mouse", action: "down", button: 0, x: d.at, y });
    key({ kind: "mouse", action: "drag", button: 0, x: d.at + 6, y });
    expect(readFileSync(f, "utf8")).toBe(before);
    key({ kind: "mouse", action: "up", button: 0, x: d.at + 6, y });
    expect(readFileSync(f, "utf8")).not.toBe(before);
  });

  test("nits: a tile dropped into a dock's tabs keeps it a dock; a ctrl+e edit tile isn't saved in the layout", async () => {
    await mine("tile.dock", { on: true }, "side");
    await mine("layout.move", { to: "side", where: "tabs" }, "now");
    expect([tile("side").dock, tile("now").dock]).toEqual([tile("side").dock, tile("side").dock]);
    expect(tile("now").dock).toBeDefined();
    await mine("tile.dock", { on: false }, "now");
    expect([tile("side").dock, tile("now").dock]).toEqual([undefined, undefined]);
    await mine("layout.move", { to: "middle", where: "down" }, "now");
    // ctrl+e's edit tile: never in desk.json (its temp file goes with the door).
    const f = join(scratch.root, "door", "edit.md");
    writeFileSync(f, "x\n");
    D().focus = idOf("middle");
    expect(D().inTile({ cmd: ["tail", "-f", f], file: f, name: "edit" }, () => {})).toBe(true);
    D().save();
    expect(readFileSync(join(scratch.root, "door", "desk.json"), "utf8")).not.toContain("edit.md");
    D().closeId(idOf("edit"));
  });

  test("S1: leaving the desk keeps it and its programs; D on the menu brings the same desk back; quitting asks", async () => {
    D().focus = idOf("tree");
    const pid = tile("claude").terminal.pid;
    key({ kind: "esc" });                                       // Esc never leaves a screen: nothing to close here
    expect(top()).toBe(desk);
    key(char("q"));
    expect(top()).toBeInstanceOf(MainMenu);
    expect((app as any).background).toContain(desk);
    expect(message()).toContain("still running");
    await Bun.sleep(200);
    expect(D().panes.get(idOf("claude")).running).toBe(true);
    const back = Desk.resume();
    expect(back).toBe(desk);
    app.push(back);
    expect((app as any).background).not.toContain(desk);
    expect(tile("claude").terminal.pid).toBe(pid);
    // Quitting from the menu with the desk in the background: asked twice, the programs named.
    key(char("q"));
    let quit = false;
    (app as any).done = () => { quit = true; };
    key(ctrl("c"));
    expect(message()).toContain("quitting ends");
    // Logging off from the menu (esc, G) asks the same: the Goodbye screen goes, the door stays.
    await Bun.sleep(3100);
    app.push(new Goodbye());
    expect(top()).toBeInstanceOf(MainMenu);
    expect(message()).toContain("quitting ends");
    expect(existsSync(join(scratch.root, "door"))).toBe(true);
    expect(quit).toBe(false);
    app.push(Desk.resume());
  });
});
