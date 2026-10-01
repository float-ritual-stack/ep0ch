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
import { Mirror } from "../src/mirror";
import { decode, encode, Ext, handle, Incomplete } from "../src/msgpack";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
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
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const render = () => app.redraw();
  const tile = (name: string) => (D().layoutGet().tiles as any[]).find(t => t.name === name);
  const idOf = (name: string) => [...D().names].find(([, v]: any) => v === name)![0];
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
  const notes: Record<string, any> = {};
  const draft = () => join(scratch.root, "door", "draft.md");

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
    const mk = (text: string) => board.request<any>("create", { parentId: null, text, author: "agent" });
    notes.long = await mk(["Seed order", ...Array.from({ length: 60 }, (_, i) => `Row ${i + 1}: ${i === 41 ? "the parsnips need your call" : "beans and peas"}`)].join("\n"));
    notes.shed = await mk("Mend the shed roof\nBuy tacks and felt.");
    writeFileSync(draft(), ["# Plot draft", ...Array.from({ length: 30 }, (_, i) => `- line ${i + 2} of the draft`)].join("\n") + "\n");
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    control = await startControl({ app, mirror: new Mirror(200, 60), info: () => term.info }, join(scratch.root, "door", "ctl.sock"));
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: "daily" });
    app.push(desk);
    render();
    await until(() => tile("draft")?.terminal?.running, "the editor tile");
  }, 30_000);

  afterAll(async () => {
    control?.close();
    D().dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR"]) delete process.env[k];
  });

  test("layout.get: each tile's kind, source, tabs, link and pinned or drawer state, and each split's path", async () => {
    const g = await act("layout.get") as any;
    expect(g.tree.split).toBe("row");
    expect(g.tree.path).toBe("");
    expect(g.tree.kids[1].path).toBe("1");
    const tree = g.tiles.find((t: any) => t.name === "tree");
    expect(tree).toMatchObject({ kind: "tree", link: "middle" });
    expect(g.tiles.find((t: any) => t.name === "preview").source).toBe("tile:tree");
    const shape = D().layoutShape();
    expect(shape.tree.path).toBe("");
    expect(shape.tree.kids[1].path).toBe("1");
    expect(shape.tiles.find((t: any) => t.tile === "claude")).toMatchObject({ kind: "pty", pinned: true, cmd: ["sh"] });
  });

  test("a terminal tile is told this door's control socket (EP0CH_CONTROL) and its own name (EP0CH_TILE)", async () => {
    // The door serves on its own path, not EP0CH_CONTROL's default: `ep0ch act` from the tile reaches this door.
    await act("tile.type", { text: "echo \"ctl=$EP0CH_CONTROL tile=$EP0CH_TILE\"\r" }, "claude");
    const said = () => (tile("claude")?.terminal?.text ?? []).join("\n");
    await until(() => said().includes(`ctl=${control.path} tile=claude`), "the tile's echo");
  });

  test("view.subscribe from another process: a click moves focus and the event arrives; a move is layout.changed", async () => {
    const f = feed();
    await until(() => f.events.some(e => e.type === "hello"), "the hello");
    expect((f.events[0] as any).state.focus.tile).toBe("tree");
    const r = tile("side").rect;
    mouse("down", r.col + 5, r.row + 5); mouse("up", r.col + 5, r.row + 5);
    await until(() => f.of("focus.changed").some((e: any) => e.tile === "side"), "focus.changed to side");
    await act("layout.move", { to: "middle", where: "tabs" }, "now");
    await until(() => f.of("layout.changed").length > 0, "layout.changed");
    const tabs = (f.of("layout.changed").at(-1) as any).layout.tiles.find((t: any) => t.tile === "now").tabs;
    expect(tabs).toEqual(["middle", "now"]);
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
    const focus = D().focus;
    await act("open", { id: notes.long.id }, "middle");
    expect(D().focus).toBe(focus);                                  // an agent's open never moves the keys
    await until(() => tile("middle").showing?.id === notes.long.id, "the note in middle");
    const mid = D().panes.get(idOf("middle"));
    await mid.surface.whole(); render();
    const s = await act("view.scrollTo", { text: "parsnips" }, "middle") as any;
    expect(s.line).toBe(43);
    expect(s.viewport.first).toBe(43);
    await until(() => f.of("viewport").some((e: any) => e.tile === "middle" && e.viewport.first === 43), "the viewport event");
    await expect(act("view.scrollTo", { line: 3, block: notes.shed.id }, "middle")).rejects.toThrow(/open it there first/);
    const m = await act("block.mark", { reason: "needs your call" }, "middle") as any;
    expect(m.showing).toEqual(["middle"]);
    await until(() => f.of("marks.changed").length > 0, "marks.changed");
    render();
    const drawn = desk.render(D().ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
    expect(drawn).toContain("◆ needs your call · by watcher-7");
    expect(D().focus).toBe(focus);
    // view.get says the same, per tile.
    const v = await act("view.get", {}, "middle") as any;
    expect(v.viewport).toMatchObject({ block: notes.long.id, first: 43 });
    // The person clicks the label: dismissed.
    const h = D().markHits[0];
    mouse("down", h.from + 1, h.row); mouse("up", h.from + 1, h.row);
    expect((await act("marks.list") as any).marks).toEqual([]);
    f.close();
  }, 20_000);

  test("one open (E1): `ep0ch open <id>` is act open, named by --as or EP0CH_AGENT; the older {cmd:open} runs the same action", async () => {
    const said = () => (app as any).message as string;
    const raw = (req: Record<string, unknown>) => new Promise<any>((res, rej) => {
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
      const focus = D().focus;
      expect(await controlClient(["open", notes.shed.id, "--as", "opener-510"])).toBe(0);
      expect(said()).toContain("an agent (opener-510)");
      expect(D().focus).toBe(focus);                                // an agent's open never moves the keys
      await until(() => (D().layoutGet().tiles as any[]).some(t => t.showing?.id === notes.shed.id), "the note shown");
      process.env.EP0CH_AGENT = "env-opener-510";
      expect(await controlClient(["open", notes.long.id])).toBe(0);
      expect(said()).toContain("an agent (env-opener-510)");
      // from= works the same way it does on act: where that tile's opens land.
      expect(await controlClient(["open", notes.shed.id, "from=claude", "--as", "opener-510"])).toBe(0);
      // Only the service writes as an extension.
      expect(await controlClient(["open", notes.shed.id, "--as", "ext:tidy"])).toBe(1);
      expect(await controlClient(["open"])).toBe(1);
    } finally {
      console.log = log; console.error = err;
      for (const [k, v] of [["EP0CH_CONTROL", env.control], ["EP0CH_AGENT", env.agent]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    // The older request is the open action too: attributed, and refused the same way.
    const r = await raw({ cmd: "open", id: notes.shed.id, as: "raw-opener-510" });
    expect(r).toMatchObject({ ok: true, result: { id: notes.shed.id } });
    expect(said()).toContain("an agent (raw-opener-510)");
    expect((await raw({ cmd: "open", id: notes.shed.id, as: "ext:tidy" })).error).toMatch(/extension's actor id/);
    // One `open` in the list: the desk's (the shell's is for screens without one).
    expect((app.actions().actions as any[]).filter(a => a.name === "open")).toHaveLength(1);
    await act("open", { id: notes.long.id }, "middle");                // as the next test expects it
  }, 20_000);

  test("marks.next takes the person to a tile showing the mark; an agent's is refused while they type", async () => {
    await act("block.mark", { id: notes.long.id, reason: "look here" });
    D().focus = idOf("tree");
    key({ kind: "alt", ch: "m" });
    expect(D().focus).toBe(idOf("middle"));
    key({ kind: "alt", ch: "x" });                                  // dismisses the marks on the focused tile's note
    expect((await act("marks.list") as any).marks).toEqual([]);
  });

  test("a border dragged is layout.resize, the action an agent calls", async () => {
    const f = feed(["layout.changed"]);
    await until(() => f.events.length > 0, "hello");
    render();
    const d = D().dividers.find((x: any) => x.node === D().root);
    const x = d.at, y = d.area.row + 5;
    mouse("down", x, y); mouse("drag", x + 12, y); mouse("up", x + 12, y);
    await until(() => f.of("layout.changed").length > 0, "layout.changed from the drag");
    const r = await act("layout.resize", { path: "", border: 0, share: 0.5 }) as any;
    expect(r).toMatchObject({ split: D().root.id, path: "", border: 0, share: 0.5 });
    // The drag named the split by its id, as an agent can.
    expect(r.split).toMatch(/^s\d+$/);
    await expect(act("layout.resize", { path: "7.7", border: 0, share: 0.5 })).rejects.toThrow(/no split at path/);
    f.close();
  });

  test.skipIf(!NVIM)("an nvim tile: the person types, an agent's tile.open lands elsewhere, and its edit through the socket leaves their cursor", async () => {
    await until(() => !!tile("draft").terminal.nvim?.connected, "the door on nvim's socket", 8000);
    const sock = tile("draft").terminal.nvim.socket as string;
    expect((await act("tile.info", {}, "draft") as any).terminal.nvim.socket).toBe(sock);
    await act("tile.preview", {}, "draft");
    const f = feed(["cursor", "focus.changed"]);
    await until(() => f.events.length > 0, "hello");
    // The person clicks into nvim, goes to line 20 and types.
    const r = tile("draft").rect;
    mouse("down", r.col + 5, r.row + 3); mouse("up", r.col + 5, r.row + 3);
    expect(D().describe().inTerminal).toBe("draft");
    for (const c of "20Gi") key(char(c));
    for (const c of "typed by the person ") key(char(c));
    await until(() => f.of("cursor").some((e: any) => e.tile === "draft" && e.cursor.line === 20 && e.cursor.mode === "i"), "nvim's cursor on line 20 in insert mode");
    // While they type: an agent's tile.open lands beside another tile, and the keys stay in nvim.
    await act("tile.open", { kind: "detail", note: notes.shed.id, name: "agent-note", where: "right" }, "side");
    expect(D().describe().inTerminal).toBe("draft");
    await expect(act("tile.focus", {}, "agent-note")).rejects.toThrow(/the person is typing/);
    // An agent edits line 1 through nvim's own socket: the person's cursor stays on line 20.
    const nv = new NvimClient(sock);
    await nv.connect();
    const before = await nv.request("nvim_win_get_cursor", [0]) as number[];
    expect(before[0]).toBe(20);
    await nv.request("nvim_buf_set_lines", [0, 0, 1, false, ["# Plot draft, retitled by an agent"]]);
    await nv.request("nvim_command", ["silent write"]);
    expect(await nv.request("nvim_win_get_cursor", [0])).toEqual(before);
    await until(() => tile("draft-preview")?.showing?.title.includes("retitled by an agent"), "the preview after the agent's write", 5000);
    // A mark on a line is an extmark with virtual text.
    const m = await act("block.mark", { line: 25, reason: "check this line" }, "draft") as any;
    expect(m.mark.extmark).toBeGreaterThan(0);
    const marks = await nv.lua(`return #vim.api.nvim_buf_get_extmarks(0, vim.api.nvim_create_namespace("ep0ch_marks"), 0, -1, {})`);
    expect(marks).toBe(1);
    expect(tile("draft-preview").source).toBe("tile:draft");
    // The person opens another file in nvim: the preview follows the buffer (nvim tells the door).
    const other = join(scratch.root, "door", "beans.md");
    writeFileSync(other, "# Bean notes\n\nTwo to a hole.\n");
    key({ kind: "esc" });
    for (const c of `:w\r:e ${other}`) key(c === "\r" ? { kind: "enter" } : char(c));
    key({ kind: "enter" });
    await until(() => tile("draft-preview")?.showing?.title.includes("Bean notes"), "the preview following nvim's buffer", 5000);
    // nvim names the file by its real path (on macOS the temp folder is under /private).
    expect(realpathSync(tile("draft").terminal.file)).toBe(realpathSync(other));
    nv.close(); f.close();
    key(ctrl("]"));
  }, 30_000);
});
