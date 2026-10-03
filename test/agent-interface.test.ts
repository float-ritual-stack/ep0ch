// The door's agent interface: agents see what the person sees, live, and change anything but where the person's
// cursor is. layout.get and view.get read it; view.subscribe (the control socket's `subscribe`) pushes
// focus.changed, viewport, cursor, layout.changed and marks.changed as they happen; view.scrollTo and block.mark
// point the person at something without moving their focus; an nvim tile listens on a socket an agent edits
// through without moving their cursor. Scratch services and fictional notes only; nvim tests run where nvim is.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { App, type ViewEvent } from "../src/app";
import { controlClient, startControl } from "../src/control";
import { Desk } from "../src/desk/desk";
import { NvimClient } from "../src/desk/nvim";
import { ReaderPane } from "../src/desk/panes";
import { external } from "../src/open";
import { Mirror } from "../src/mirror";
import { decode, encode, Ext, handle, Incomplete } from "../src/msgpack";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { terminalDay } from "./terminal-day";
import { outliner, Scratch, until } from "./scratch";

const NVIM = process.env.EP0CH_TEST_NVIM || Bun.which("nvim");
const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe("msgpack, as nvim's RPC uses it", () => {
  test("values round-trip: integers of every width, floats, strings, arrays, maps, nil and booleans", () => {
    for (const v of [0, 1, 127, 128, 255, 256, 65535, 65536, 2 ** 32 + 5, -1, -32, -33, -128, -129, -40000, -(2 ** 31), 1.5, "", "jam", "é".repeat(40), "x".repeat(300), [1, [2, "three"]], { a: 1, b: [true, false, null] }, null, true, false])
      expect(decode(encode(v)).value).toEqual(v);
  });
  test("a value cut short says so (the rest is still coming); nvim's handles are ext", () => {
    const b = encode(["a request", 42]);
    expect(() => decode(b.subarray(0, b.length - 1))).toThrow(Incomplete);
    const buf = decode(Uint8Array.from([0xd4, 0, 7])).value;
    expect(buf).toBeInstanceOf(Ext);
    expect(handle(buf)).toBe(7);
  });
});

describe.skipIf(!outliner)("the agent interface, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk, control: { path: string; close(): void };
  let key: (k: Key) => void = () => {};
  const AS = "watcher-7";
  /** An agent's action through the App's dispatcher: its answer is data, read with toMatchObject. */
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  /** The person's own action, through the desk's dispatcher (their key's path). */
  const mine = (action: string, reader?: string) => desk.dispatch.act({ action, ...(reader ? { tile: reader } : {}) }, USER);
  const render = () => app.redraw();
  /** A tile as layout.get describes it; a terminal's own facts, as its kind describes them. */
  const tile = (name: string) => desk.layoutGet().tiles.find(t => t.name === name);
  type Term = { running?: boolean; text?: string[]; file?: string; nvim?: { socket: string; connected?: boolean } };
  const terminal = (name: string) => (tile(name) as { terminal?: Term } | undefined)?.terminal;
  /** Where the person is: the shell's one answer (PIE-514). */
  const person = () => app.person();
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
  const notes: Record<"long" | "shed", { id: string }> = { long: { id: "" }, shed: { id: "" } };
  const draft = () => join(scratch.root, "door", "draft.md");
  /** What the status bar said, in order. */
  const said: string[] = [];
  /** The rows the desk draws now, without colour. */
  const drawn = () => desk.render(app).lines.map(l => l.replace(/\x1b\[[\d;]*m/g, ""));

  /** A second process's view: the control socket's live feed, as `ep0ch subscribe` reads it. */
  function feed(types?: string[]) {
    const events: ViewEvent[] = [];
    const c = connect(control.path, () => c.write(JSON.stringify({ cmd: "subscribe", ...(types ? { types } : {}) }) + "\n"));
    let buf = "";
    c.on("data", d => { buf += d.toString(); for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) { events.push(JSON.parse(buf.slice(0, i)).event); buf = buf.slice(i + 1); } });
    return { events, close: () => c.end(), of: (t: string) => events.filter(e => e.type === t) };
  }

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = draft();
    process.env.EDITOR = NVIM ? `${NVIM} --clean` : "tail -f";
    delete process.env.VISUAL;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = (text: string) => board.request<{ id: string }>("create", { parentId: null, text, author: "agent" });
    notes.long = await mk(["Seed order", ...Array.from({ length: 60 }, (_, i) => `Row ${i + 1}: ${i === 41 ? "the parsnips need your call" : "beans and peas"}`)].join("\n"));
    notes.shed = await mk("Mend the shed roof\nBuy tacks and felt.");
    writeFileSync(draft(), ["# Plot draft", ...Array.from({ length: 30 }, (_, i) => `- line ${i + 2} of the draft`)].join("\n") + "\n");
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: (k: Key) => void) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as unknown as ConstructorParameters<typeof App>[0], board, Date.now(), () => {});
    const flash = app.flash.bind(app);
    app.flash = (m: string, ms?: number) => { said.push(m); flash(m, ms); };
    control = await startControl({ app, mirror: new Mirror(200, 60), info: () => term.info }, join(scratch.root, "door", "ctl.sock"));
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: terminalDay() });
    app.push(desk);
    render();
    await until(() => !!terminal("draft")?.running, "the editor tile");
  }, 30_000);

  afterAll(async () => {
    control?.close();
    desk.dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  test("layout.get: each tile's kind, source, tabs, link and pinned or drawer state, and each split's path", async () => {
    expect(await act("layout.get")).toMatchObject({ tree: { split: "row", path: "", kids: expect.arrayContaining([expect.objectContaining({ path: "1" })]) } });
    const tiles = desk.layoutGet().tiles;
    expect(tiles.find(t => t.name === "tree")).toMatchObject({ kind: "tree", link: "middle" });
    expect(tiles.find(t => t.name === "preview")).toMatchObject({ source: "tile:tree" });
    // The feed's view of the shape says the same.
    expect(desk.viewState().layout).toMatchObject({ tree: { path: "", kids: expect.arrayContaining([expect.objectContaining({ path: "1" })]) }, tiles: expect.arrayContaining([expect.objectContaining({ tile: "claude", kind: "pty", pinned: true, cmd: ["sh"] })]) });
  });

  test("a terminal tile is told this door's control socket (EP0CH_CONTROL) and its own name (EP0CH_TILE)", async () => {
    // The door serves on its own path, not EP0CH_CONTROL's default: `ep0ch act` from the tile reaches this door.
    await act("tile.type", { text: "echo \"ctl=$EP0CH_CONTROL tile=$EP0CH_TILE\"\r" }, "claude");
    await until(() => (terminal("claude")?.text ?? []).join("\n").includes(`ctl=${control.path} tile=claude`), "the tile's echo");
  });

  test("view.subscribe from another process: a click moves focus and the event arrives; a move is layout.changed", async () => {
    const f = feed();
    await until(() => f.events.some(e => e.type === "hello"), "the hello");
    expect(f.events[0]).toMatchObject({ state: { focus: { tile: "tree" } } });
    const r = tile("side")!.rect!;
    mouse("down", r.col + 5, r.row + 5); mouse("up", r.col + 5, r.row + 5);
    await until(() => f.of("focus.changed").some(e => e.tile === "side"), "focus.changed to side");
    expect(person().focus).toBe("side");
    await act("layout.move", { to: "middle", where: "tabs" }, "now");
    await until(() => f.of("layout.changed").length > 0, "layout.changed");
    expect(f.of("layout.changed").at(-1)).toMatchObject({ layout: { tiles: expect.arrayContaining([expect.objectContaining({ tile: "now", tabs: ["middle", "now"] })]) } });
    // Only what was asked for, when a subscriber names types.
    const only = feed(["marks.changed"]);
    await until(() => only.events.length > 0, "its hello");
    mouse("down", r.col + 5, r.row + 6); mouse("up", r.col + 5, r.row + 6);
    await Bun.sleep(100);
    expect(only.events.every(e => e.type === "hello" || e.type === "marks.changed")).toBe(true);
    f.close(); only.close();
    await act("layout.move", { where: "edge-left" }, "now");
  });

  test("open a note in a tile, view.scrollTo a line, block.mark it: framed and labelled, the person's focus unmoved", async () => {
    const f = feed();
    await until(() => f.events.length > 0, "hello");
    const focus = person().focus;
    await act("open", { id: notes.long.id }, "middle");
    expect(person().focus).toBe(focus);                             // an agent's open never moves the keys
    await until(() => desk.dispatch.tile("middle")?.shows === notes.long.id, "the note in middle");
    await act("folds", {}, "middle");                               // its whole note read
    render();
    expect(await act("view.scrollTo", { text: "parsnips" }, "middle")).toMatchObject({ line: 43, viewport: { first: 43 } });
    await until(() => f.of("viewport").some(e => e.tile === "middle" && (e.viewport as { first?: number }).first === 43), "the viewport event");
    await expect(act("view.scrollTo", { line: 3, block: notes.shed.id }, "middle")).rejects.toThrow(/open it there first/);
    expect(await act("block.mark", { reason: "needs your call" }, "middle")).toMatchObject({ showing: ["middle"] });
    await until(() => f.of("marks.changed").length > 0, "marks.changed");
    render();
    const label = "◆ needs your call · by watcher-7";
    expect(drawn().join("\n")).toContain(label);
    expect(person().focus).toBe(focus);
    // view.get says the same, per tile.
    expect(await act("view.get", {}, "middle")).toMatchObject({ viewport: { block: notes.long.id, first: 43 } });
    // The person clicks the label: dismissed.
    const rows = drawn(), y = rows.findIndex(l => l.includes(label)), x = rows[y]!.indexOf(label) + 2;
    mouse("down", x, y); mouse("up", x, y);
    expect(await act("marks.list")).toMatchObject({ marks: [] });
    f.close();
  }, 20_000);

  test("one open (E1): `ep0ch open <id>` is act open, named by --as or EP0CH_AGENT; the old {cmd:open} is gone", async () => {
    const lastSaid = () => said.at(-1) ?? "";
    const raw = (req: Record<string, unknown>) => new Promise<{ ok: boolean; result?: unknown; error?: string }>((res, rej) => {
      const c = connect(control.path, () => c.write(JSON.stringify(req) + "\n"));
      let buf = "";
      c.on("data", d => { buf += d.toString(); const i = buf.indexOf("\n"); if (i >= 0) { c.end(); res(JSON.parse(buf.slice(0, i))); } });
      c.on("error", rej);
    });
    const env = { control: process.env.EP0CH_CONTROL, agent: process.env.EP0CH_AGENT };
    process.env.EP0CH_CONTROL = control.path;
    delete process.env.EP0CH_AGENT;
    const log = console.log, err = console.error;
    console.log = () => {}; console.error = () => {};
    try {
      const focus = person().focus;
      expect(await controlClient(["open", notes.shed.id, "--as", "opener-510"])).toBe(0);
      expect(said.some(m => m.includes("an agent (opener-510)"))).toBe(true);
      expect(person().focus).toBe(focus);                           // an agent's open never moves the keys
      await until(() => desk.layoutGet().tiles.some(t => t.showing?.id === notes.shed.id), "the note shown");
      process.env.EP0CH_AGENT = "env-opener-510";
      expect(await controlClient(["open", notes.long.id])).toBe(0);
      expect(said.some(m => m.includes("an agent (env-opener-510)"))).toBe(true);
      // from= works the same way it does on act: where that tile's opens land.
      expect(await controlClient(["open", notes.shed.id, "from=claude", "--as", "opener-510"])).toBe(0);
      // Only the service writes as an extension.
      expect(await controlClient(["open", notes.shed.id, "--as", "ext:tidy"])).toBe(1);
      expect(await controlClient(["open"])).toBe(1);
    } finally {
      console.log = log; console.error = err;
      for (const [k, v] of [["EP0CH_CONTROL", env.control], ["EP0CH_AGENT", env.agent]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    expect(await raw({ cmd: "open", id: notes.shed.id, as: "raw-opener-510" })).toMatchObject({ ok: false, error: expect.stringContaining("unknown command open") });
    // One `open` in the list: the desk's (the shell's is for screens without one).
    expect(app.actions().actions.filter(a => a.name === "open")).toHaveLength(1);
    expect(lastSaid()).toBeTruthy();
    await act("open", { id: notes.long.id }, "middle");                // as the next test expects it
  }, 20_000);

  test("marks.next takes the person to a tile showing the mark; an agent's is refused while they type", async () => {
    await act("block.mark", { id: notes.long.id, reason: "look here" });
    await mine("tile.focus", "tree");
    expect(person().focus).toBe("tree");
    key({ kind: "alt", ch: "m" });
    expect(person().focus).toBe("middle");
    key({ kind: "alt", ch: "x" });                                  // dismisses the marks on the focused tile's note
    expect(await act("marks.list")).toMatchObject({ marks: [] });
  });

  test("an agent never opens the browser, and never moves the reader the person has (round 3, C1 C3)", async () => {
    const ran: string[][] = [];
    const run = external.run;
    external.run = cmd => { ran.push(cmd); };
    try {
      const fence = (await board.request<{ id: string }>("create", { parentId: notes.shed.id, text: `Fence quote\nAsk [the supplier](https://example.invalid/fence) and see ((${notes.long.id}|the seed order)).`, author: "agent" })).id;
      await mine("tile.focus", "tree");
      await act("open", { id: fence }, "side");
      await until(() => desk.dispatch.tile("side")?.shows === fence, "the note in side");
      const side = () => (desk.pane("side") as ReaderPane).surface;
      await until(() => side().describe().links.length === 2, "its links");
      // A web link: the agent is given the address; nothing outside the door opens, and the screen says so.
      expect(await act("link.follow", { n: 1 }, "side")).toMatchObject({ opened: null, outside: "browser", url: "https://example.invalid/fence", launched: false });
      expect(ran).toEqual([]);
      expect(said.at(-1)).toMatch(/watcher-7.*was given https:\/\/example\.invalid\/fence · an agent doesn't open the browser/);
      // ...and the person's [ ] position stayed where it was (none).
      expect(side().describe().links.some(l => l.selected)).toBe(false);
      // In the reader the person has, every action that would move what they read is refused, the agent's way said.
      await mine("tile.focus", "side");
      const shown = side().msg?.id;
      await expect(act("link.follow", { n: 2 }, "side")).rejects.toThrow(/side has the person's keys; following a link there would move what they're reading/);
      await expect(act("element.open", { n: 2 }, "side")).rejects.toThrow(/side has the person's keys; opening an element there/);
      await expect(act("up", {}, "side")).rejects.toThrow(/side has the person's keys; up would move what they're reading/);
      await expect(act("threads", {}, "side")).rejects.toThrow(/side has the person's keys/);
      await expect(act("props.follow", { n: 1 }, "side")).rejects.toThrow(/side has the person's keys/);
      await expect(act("open", { id: notes.shed.id }, "side")).rejects.toThrow(/side has the person's keys; opening a note there would move what they're reading/);
      expect(side().msg?.id).toBe(shown);
      await mine("tile.focus", "tree");
    } finally { external.run = run; }
  }, 20_000);

  test("an open naming no tile lands where opens land, even the note the person reads: said on screen, never their keys, never a reader they type in", async () => {
    const mid = () => (desk.pane("middle") as ReaderPane);
    // The person on the tree, whose opens land in middle: the agent's tile-less open shows the note there (the
    // designed "show the person" path), their keys stay on the tree, and it's said on the status bar.
    await mine("tile.focus", "tree");
    const r = await act("open", { id: notes.shed.id }) as { reader: string | null; id: string };
    expect(r).toMatchObject({ reader: "middle", id: notes.shed.id });
    await until(() => mid().msg?.id === notes.shed.id, "the note in middle");
    expect(person().focus).toBe("tree");
    expect(said.at(-1)).toMatch(/watcher-7.*opened a note in middle/);
    // The person reading middle themselves: it lands where opens land from there (a reader that follows), keys unmoved.
    await mine("tile.focus", "middle");
    const r2 = await act("open", { id: notes.long.id }) as { reader: string | null };
    expect(r2.reader).toBeTruthy();
    expect(person().focus).toBe("middle");
    // Typing in middle: the open never lands in that reader; their edit and its note stay.
    await desk.dispatch.act({ action: "edit", args: {}, tile: "middle" }, USER);
    key(char("e"));
    await until(() => person().typingIn === "middle", "the person typing in middle");
    const typing = mid().msg?.id;
    const landed = await act("open", { id: notes.shed.id }) as { reader: string | null };
    expect(landed.reader).not.toBe("middle");
    expect(mid().msg?.id).toBe(typing);
    expect(person().typingIn).toBe("middle");
    await desk.dispatch.act({ action: "edit.close", args: { discard: true }, tile: "middle" }, USER).catch(() => {});
    await mine("tile.focus", "tree");
  }, 20_000);

  test("a border dragged is layout.resize, the action an agent calls", async () => {
    const f = feed(["layout.changed"]);
    await until(() => f.events.length > 0, "hello");
    render();
    // The root split's first border: just right of its first kid's tiles.
    const got = await act("layout.get") as { tree: { id: string; kids: { tiles?: string[] }[] } };
    const left = desk.layoutGet().tiles.filter(t => t.rect && t.rect.col === 0 && t.shown);
    const x = Math.max(...left.map(t => t.rect!.col + t.rect!.cols)), y = left[0]!.rect!.row + 5;
    mouse("down", x, y); mouse("drag", x + 12, y); mouse("up", x + 12, y);
    await until(() => f.of("layout.changed").length > 0, "layout.changed from the drag");
    // The drag named the split by its id, as an agent can.
    expect(await act("layout.resize", { path: "", border: 0, share: 0.5 })).toMatchObject({ split: got.tree.id, path: "", border: 0, share: 0.5 });
    expect(got.tree.id).toMatch(/^s\d+$/);
    await expect(act("layout.resize", { path: "7.7", border: 0, share: 0.5 })).rejects.toThrow(/no split at path/);
    f.close();
  });

  test.skipIf(!NVIM)("an nvim tile: the person types, an agent's tile.open lands elsewhere, and its edit through the socket leaves their cursor", async () => {
    await until(() => !!terminal("draft")?.nvim?.connected, "the door on nvim's socket", 8000);
    const sock = terminal("draft")!.nvim!.socket;
    expect(await act("tile.info", {}, "draft")).toMatchObject({ terminal: { nvim: { socket: sock } } });
    await act("tile.preview", {}, "draft");
    const f = feed(["cursor", "focus.changed"]);
    await until(() => f.events.length > 0, "hello");
    // The person clicks into nvim, goes to line 20 and types.
    const r = tile("draft")!.rect!;
    mouse("down", r.col + 5, r.row + 3); mouse("up", r.col + 5, r.row + 3);
    expect(person().typingIn).toBe("draft");
    for (const c of "20Gi") key(char(c));
    for (const c of "typed by the person ") key(char(c));
    await until(() => f.of("cursor").some(e => e.tile === "draft" && (e.cursor as { line?: number; mode?: string }).line === 20 && (e.cursor as { mode?: string }).mode === "i"), "nvim's cursor on line 20 in insert mode");
    // While they type: an agent's tile.open lands beside another tile, and the keys stay in nvim.
    await act("tile.open", { kind: "detail", note: notes.shed.id, name: "agent-note", where: "right" }, "side");
    expect(person().typingIn).toBe("draft");
    await expect(act("tile.focus", {}, "agent-note")).rejects.toThrow(/the person is typing/);
    // An agent edits line 1 through nvim's own socket: the person's cursor stays on line 20.
    const nv = new NvimClient(sock);
    await nv.connect();
    const before = await nv.request("nvim_win_get_cursor", [0]) as number[];
    expect(before[0]).toBe(20);
    await nv.request("nvim_buf_set_lines", [0, 0, 1, false, ["# Plot draft, retitled by an agent"]]);
    await nv.request("nvim_command", ["silent write"]);
    expect(await nv.request("nvim_win_get_cursor", [0])).toEqual(before);
    await until(() => !!tile("draft-preview")?.showing?.title.includes("retitled by an agent"), "the preview after the agent's write", 5000);
    // A mark on a line is an extmark with virtual text.
    expect(await act("block.mark", { line: 25, reason: "check this line" }, "draft")).toMatchObject({ mark: { extmark: expect.any(Number) } });
    const marks = await nv.lua(`return #vim.api.nvim_buf_get_extmarks(0, vim.api.nvim_create_namespace("ep0ch_marks"), 0, -1, {})`);
    expect(marks).toBe(1);
    expect(tile("draft-preview")).toMatchObject({ source: "tile:draft" });
    // The person opens another file in nvim: the preview follows the buffer (nvim tells the door).
    const other = join(scratch.root, "door", "beans.md");
    writeFileSync(other, "# Bean notes\n\nTwo to a hole.\n");
    key({ kind: "esc" });
    for (const c of `:w\r:e ${other}`) key(c === "\r" ? { kind: "enter" } : char(c));
    key({ kind: "enter" });
    await until(() => !!tile("draft-preview")?.showing?.title.includes("Bean notes"), "the preview following nvim's buffer", 5000);
    // nvim names the file by its real path (on macOS the temp folder is under /private).
    expect(realpathSync(terminal("draft")!.file!)).toBe(realpathSync(other));
    nv.close(); f.close();
    key(ctrl("]"));
  }, 30_000);
});
