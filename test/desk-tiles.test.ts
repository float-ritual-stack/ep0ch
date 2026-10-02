// PIE-413, PIE-417, PIE-473, PIE-474: the desk as tiles, against a scratch outline. A header dragged onto a
// tile's centre makes tabs, onto a side splits, onto the outer edge makes a column; tabs are clicked and
// cycled; alt+l then a click links a tile's opens; a preview follows a tile or a file; a terminal tile takes
// every key but ctrl+]; a tile slides over as a drawer and pins back; layouts save, load and keep running
// programs; the river's open rule adds columns. Every one of them is an action an agent can call, and an
// agent's never takes the person's focus or keys. Scratch services, fictional notes, `sh` and `tail` only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { keyBytes, mouseBytes } from "../src/desk/pty";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { terminalDay } from "./terminal-day";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const alt = (ch: string): Key => ({ kind: "alt", ch });

describe("terminal keys and the mouse, as a terminal sends them", () => {
  test("keys: ctrl letters, arrows (application mode as SS3), alt, the escape chord's own byte", () => {
    expect(keyBytes(char("a"))).toBe("a");
    expect(keyBytes(ctrl("w"))).toBe("\x17");
    expect(keyBytes(ctrl("]"))).toBe("\x1d");
    expect(keyBytes({ kind: "up" })).toBe("\x1b[A");
    expect(keyBytes({ kind: "up" }, true)).toBe("\x1bOA");
    expect(keyBytes(alt("x"))).toBe("\x1bx");
    expect(keyBytes({ kind: "enter" })).toBe("\r");
    expect(keyBytes({ kind: "backspace" })).toBe("\x7f");
  });
  test("the mouse: SGR when the program asked for it, the old bytes otherwise; drags and the wheel", () => {
    expect(mouseBytes({ kind: "mouse", action: "down", button: 0, x: 4, y: 2 }, 4, 2, true)).toBe("\x1b[<0;5;3M");
    expect(mouseBytes({ kind: "mouse", action: "up", button: 0, x: 4, y: 2 }, 4, 2, true)).toBe("\x1b[<0;5;3m");
    expect(mouseBytes({ kind: "mouse", action: "drag", button: 0, x: 0, y: 0 }, 0, 0, true)).toBe("\x1b[<32;1;1M");
    expect(mouseBytes({ kind: "mouse", action: "wheel-down", button: 0, x: 0, y: 0 }, 0, 0, true)).toBe("\x1b[<65;1;1M");
    expect(mouseBytes({ kind: "mouse", action: "down", button: 0, x: 0, y: 0, mods: 16 }, 0, 0, true)).toBe("\x1b[<16;1;1M");
    expect(mouseBytes({ kind: "mouse", action: "down", button: 0, x: 1, y: 1 }, 1, 1, false)).toBe("\x1b[M\x20\x22\x22");
  });
});

describe.skipIf(!outliner)("the desk as tiles, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "tile-agent-413";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string, as: string | null = AS) => app.act({ action, args, tile: reader, ...(as ? { as } : {}) });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => D().dispatch.act({ action, args, tile: reader }, { kind: "user" });
  const message = () => (app as any).message as string;
  const render = () => desk.render(D().ctx);
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[] };
  const tile = (name: string) => get().tiles.find((t: any) => t.name === name);
  const rect = (name: string) => { render(); return tile(name).rect as { col: number; row: number; cols: number; rows: number }; };
  const mouse = (action: "down" | "drag" | "up", x: number, y: number, mods?: number) => key({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) });
  const drag = (x0: number, y0: number, x1: number, y1: number) => { render(); mouse("down", x0, y0); mouse("drag", x0 + 1, y0); render(); mouse("drag", x1, y1); render(); mouse("up", x1, y1); render(); };
  /** The tree as a short string, as the unit tests write it. */
  const s = (n: any): string => n.pane ?? (n.tabs ? `tabs(${n.tabs.map((t: string) => (t === n.active ? "*" + t : t)).join(",")})` : n.drawer ? `drawer(${s(n.kid)})` : `${n.split ?? (n.flow ? "flow" : "?")}(${n.kids.map(s).join(",")})`);
  const shape = () => s(get().tree);
  let notes: Record<string, any> = {};
  const draft = () => join(scratch.root, "door", "draft.md");

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EP0CH_DAILY_DRAFT = join(scratch.root, "door", "draft.md");
    process.env.EDITOR = "tail -f";
    process.env.EP0CH_NOW_PAGE = "garden-now";
    delete process.env.VISUAL;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = async (text: string) => board.request<any>("create", { parentId: null, text, author: "agent" });
    notes.shed = await mk("Mend the shed roof\nBuy tacks and felt.");
    notes.beans = await mk("Sow the beans\nTwo to a hole.");
    notes.plan = await mk(`Week plan\nFirst ((${notes.beans.id})), then ((${notes.shed.id})).`);
    notes.now = await mk("Garden, right now [page::garden-now]\nThe beans are in; the shed waits for felt.");
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk(undefined, { layout: terminalDay() });
    app.push(desk);
    render();
    await until(() => tile("claude")?.terminal?.running && tile("draft")?.terminal?.running, "the daily terminals");
  }, 30_000);

  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_DRAFT", "EDITOR", "EP0CH_NOW_PAGE"]) delete process.env[k];
  });

  test("daily: now on the left (the agent is the host layer's, beside it), the tree and its preview over middle, the editor over side; tree, now and side open into middle", () => {
    // Here with a terminal of the person's own over now (terminal-day); the daily layout itself has none.
    expect(shape()).toBe("row(col(claude,now),col(tree,preview,middle),col(draft,side))");
    const { builtin } = require("../src/desk/tiles");
    expect(JSON.stringify(builtin("daily").root)).not.toContain(`"kind":"pty","name":"claude"`);
    expect(tile("tree").link).toBe("middle");
    expect(tile("now").link).toBe("middle");
    expect(tile("side").link).toBe("middle");
    expect(tile("preview").source).toBe("tile:tree");
    expect(tile("draft").terminal.cmd).toEqual(["tail", "-f", draft()]);
    expect(tile("draft").terminal.file).toBe(draft());
    expect(existsSync(draft())).toBe(true);
    expect(get().focus).toBe("tree");
  });

  test("daily: EP0CH_DAILY_CWD sets the folder the agent (the host layer's) starts in, ~ meaning home", () => {
    const { dailyAgent } = require("../src/desk/tiles");
    process.env.EP0CH_DAILY_CWD = "~/garden";
    try { expect(dailyAgent().cwd).toBe(`${require("node:os").homedir()}/garden`); } finally { delete process.env.EP0CH_DAILY_CWD; }
    expect(dailyAgent().cwd).toBeUndefined();
  });

  test("daily: the now tile is pinned to the now page (EP0CH_NOW_PAGE), and saves as that page, not its note", async () => {
    const now = () => [...D().panes.values()].find((p: any) => p.kind === "detail" && p.page);
    await until(() => now()?.msg?.id === notes.now.id, "the now page in the now tile");
    expect(now().page).toBe("garden-now");
    expect(now().spec()).toEqual({ page: "garden-now" });
  });

  test("a header dropped on a tile's lower triangle splits it; on its centre, tabs; on the outer right edge, a column", () => {
    const d = rect("draft"), t = rect("tree");
    drag(d.col + 4, d.row, t.col + Math.floor(t.cols / 2), t.row + t.rows - 2);
    expect(shape()).toBe("row(col(claude,now),col(tree,draft,preview,middle),side)");
    expect(message()).toBe("moved draft below tree");
    expect(get().focus).toBe("draft");
    const n = rect("now"), t2 = rect("tree");
    drag(n.col + 4, n.row, t2.col + Math.floor(t2.cols / 2), t2.row + Math.floor(t2.rows / 2));
    expect(shape()).toBe("row(claude,col(tabs(tree,*now),draft,preview,middle),side)");
    // The tab set's header: a click on a tab's label shows it; alt+n and alt+p step through them.
    render();
    const head = D().heads.find((h: any) => h.id === [...D().names].find(([, v]: any) => v === "tree")[0]);
    mouse("down", head.from + 1, head.row); mouse("up", head.from + 1, head.row);
    expect(tile("tree").tabShown).toBe("tree");
    key(alt("n")); expect(tile("now").tabShown).toBe("now");
    key(alt("p")); expect(tile("tree").tabShown).toBe("tree");
    // A tab dragged out by its label to the outer right edge: a full-height column.
    render();
    const nowHead = D().heads.find((h: any) => h.id === [...D().names].find(([, v]: any) => v === "now")[0]);
    drag(nowHead.from + 1, nowHead.row, 199, 30);
    expect(shape()).toBe("row(claude,col(tree,draft,preview,middle),side,now)");
  });

  test("while a header is dragged, the drop it would make is drawn and said; esc lets go", () => {
    const d = rect("draft"), m = rect("middle");
    mouse("down", d.col + 4, d.row); mouse("drag", d.col + 6, d.row); mouse("drag", m.col + 1, m.row + Math.floor(m.rows / 2)); render();
    expect(D().describe().dragging).toMatchObject({ tile: "draft", drop: { kind: "split", target: "middle", dir: "left" } });
    const drawn = D().render(D().ctx).lines.join("\n");
    expect(drawn).toContain("← split left");
    key({ kind: "esc" });
    mouse("up", m.col + 1, m.row + 5);
    expect(D().describe().dragging).toBeNull();
    expect(message()).toContain("not moved");
  });

  test("the keys do what a drag does: ^W m moves beside, ^W t into tabs, ^W T takes a tab out, ^W L to the edge", () => {
    D().focus = [...D().names].find(([, v]: any) => v === "side")[0];
    key(ctrl("w")); key(char("t")); key(char("h"));            // side into the tabs of the tile to its left
    expect(shape()).toContain("tabs(");
    expect(tile("side").tabs).toContain("side");
    key(ctrl("w")); key(char("T"));                              // and out again, beside the tabs
    expect(tile("side").tabs).toBeUndefined();
    key(ctrl("w")); key(char("L"));                              // to the right edge
    expect(shape().endsWith(",side)")).toBe(true);
    key(ctrl("w")); key(char("m")); key(char("h"));              // beside the tile to its left, on that side
    expect(shape()).toMatch(/side,now\)$/);
  });

  test("alt+l, then a click, links a tile's opens; a followed link and the tree's ⏎ land there; a ctrl-click opens beside", async () => {
    await mine("layout.load", { name: "terminal-day" });
    render();
    await act("open", { id: notes.plan.id }, "side");
    await until(() => tile("side").showing?.id === notes.plan.id, "the plan in side");
    // Unlink side (alt+l, click itself), then link it to middle (alt+l, click middle).
    const sd = rect("side"), md = rect("middle");
    D().focus = [...D().names].find(([, v]: any) => v === "side")[0];
    key(alt("l")); mouse("down", sd.col + 3, sd.row + 3);
    expect(tile("side").link).toBeUndefined();
    key(alt("l")); render();
    expect(D().render(D().ctx).lines.join("\n")).toContain("click to link here");
    mouse("down", md.col + 3, md.row + 3);
    expect(tile("side").link).toBe("middle");
    // A link followed in side opens in middle; side keeps its note.
    render();
    const side = D().panes.get([...D().names].find(([, v]: any) => v === "side")[0]);
    await side.surface.whole();
    render();
    const link = side.surface.describe().links[0];
    expect(link).toBeTruthy();
    await side.act("link.follow", { n: 1 }, D(), { kind: "user" });
    await until(() => tile("middle").showing?.id === notes.beans.id, "the link in middle");
    expect(tile("side").showing.id).toBe(notes.plan.id);
    // The tree's ⏎ opens into middle too.
    const tree = D().panes.get([...D().names].find(([, v]: any) => v === "tree")[0]);
    await until(() => tree.rows?.length > 3, "the tree's rows");
    tree.sel = tree.rows.findIndex((r: any) => r.m.id === notes.shed.id);
    D().focus = [...D().names].find(([, v]: any) => v === "tree")[0];
    key({ kind: "enter" });
    await until(() => tile("middle").showing?.id === notes.shed.id, "the tree's ⏎ in middle");
    expect(get().focus).toBe("tree");
    // An agent links, and a link to a terminal is refused with the reason.
    await expect(act("tile.link", { to: "claude" }, "now")).rejects.toThrow(/opens land in a tile that takes notes/);
    expect(await act("tile.link", {}, "now")).toMatchObject({ link: null });
  }, 30_000);

  test("a preview follows its source tile, and a file preview is re-read when the file changes, read-only", async () => {
    const tree = D().panes.get([...D().names].find(([, v]: any) => v === "tree")[0]);
    D().focus = [...D().names].find(([, v]: any) => v === "tree")[0];
    tree.sel = tree.rows.findIndex((r: any) => r.m.id === notes.beans.id);
    key(char("j")); key(char("k"));
    await until(() => tile("preview").showing?.id === notes.beans.id, "the preview following the tree");
    const r = await act("tile.preview", {}, "draft") as any;
    expect(r.tile).toBe("draft-preview");
    expect(tile("draft-preview").source).toBe(`file:${draft()}`);
    await until(() => tile("draft-preview").showing?.title.includes("scratch"), "the draft in its preview");
    writeFileSync(draft(), `# Pea notes\n\nSee ((${notes.plan.id})).\n`);
    await until(() => tile("draft-preview").showing?.title.includes("Pea notes"), "the preview re-read", 5000);
    D().focus = [...D().names].find(([, v]: any) => v === "draft-preview")[0];
    key(char("e"));
    expect(message()).toContain("a file preview only reads");
    expect(tile("draft-preview").editing).toBeUndefined();
  }, 20_000);

  test("a terminal tile takes every key the person types, ctrl+c and ^W included, until ctrl+]; an agent can't type into it then", async () => {
    const t = rect("claude");
    mouse("down", t.col + 5, t.row + 5); mouse("up", t.col + 5, t.row + 5);
    expect(D().describe().inTerminal).toBe("claude");
    expect(D().rawKeys()).toBe(true);
    for (const c of "echo tile-$((6*7))") key(char(c));
    key({ kind: "enter" });
    await until(() => tile("claude").terminal.text.some((l: string) => l.includes("tile-42")), "the shell's answer");
    key(ctrl("w"));                                                  // the shell's, not the desk's window prefix
    expect(D().prefix).toBe("");
    await expect(act("tile.type", { text: "rm -rf nothing\\n" }, "claude")).rejects.toThrow(/typing in claude/);
    await expect(act("tile.focus", {}, "middle")).rejects.toThrow(/the person is typing/);
    key(ctrl("]"));
    expect(D().describe().inTerminal).toBeNull();
    expect(D().rawKeys()).toBe(false);
    // Out of it, an agent may type into it (said on screen), and ⏎ goes back in.
    await act("tile.type", { text: "echo agent-typed\\n" }, "claude");
    await until(() => tile("claude").terminal.text.some((l: string) => l.includes("agent-typed")), "the agent's typing");
    key({ kind: "enter" });
    expect(D().describe().inTerminal).toBe("claude");
    key(ctrl("]"));
  }, 20_000);

  test("any tile slides over as a drawer (nothing moves for it), slides shut when the keys leave, opens from its handle, pins back", () => {
    const tree = () => [...D().names].find(([, v]: any) => v === "tree")[0];
    D().focus = tree();
    const before = rect("preview");
    key(ctrl("w")); key(char("p"));
    expect(tile("tree").drawer).toBe("open");
    const under = rect("preview");
    expect(under.row).toBeLessThan(before.row);                       // the tree's room is the preview's now
    key({ kind: "tab" });
    expect(tile("tree").drawer).toBe("shut");
    render();
    const h = D().handles[0];
    mouse("down", h.from + 1, 58);
    expect(tile("tree").drawer).toBe("open");
    expect(get().focus).toBe("tree");
    key(ctrl("w")); key(char("p"));
    expect(tile("tree").drawer).toBeUndefined();
    expect(rect("preview")).toEqual(before);
  });

  test("layouts: saved by name with names, links, sources and drawers; loaded back, running programs kept, not ended", async () => {
    await act("tile.pin", { on: false }, "now");
    await act("tile.drawer", { open: false }, "now");
    await mine("layout.save", { name: "garden" });
    const saved = JSON.parse(readFileSync(join(scratch.root, "door", "layouts.json"), "utf8")).garden;
    expect(JSON.stringify(saved)).toContain(`"t":"drawer","edge":"down","open":false`);   // a drawer container, shut
    expect(JSON.stringify(saved)).toContain(`"link":"middle"`);
    expect(JSON.stringify(saved)).toContain(`"source":"tile:tree"`);
    const pid = tile("claude").terminal.pid;
    await mine("layout.load", { name: "river" });
    expect(tile("claude").drawer).toBe("shut");                      // no place in the river: kept, shut
    expect(tile("claude").terminal.pid).toBe(pid);
    await mine("layout.load", { name: "garden" });
    expect(tile("claude").terminal.pid).toBe(pid);                   // reused by name
    expect(tile("claude").drawer).toBeUndefined();
    expect(tile("now").drawer).toBe("shut");
    expect(get().tiles.length).toBe(JSON.stringify(saved).match(/"t":"leaf"/g)!.length);
    await expect(mine("layout.load", { name: "nope" })).rejects.toThrow(/no layout nope/);
  });

  test("the river layout is the river's columns on the desk (a flow, the Library first), a card preview following them", async () => {
    await mine("layout.load", { name: "river" });
    expect(shape()).toBe("row(flow(library),card,drawer(tabs(*claude,draft)))");  // the running programs, kept in a shut drawer
    expect([tile("claude").drawer, tile("draft").drawer]).toEqual(["shut", "shut"]);
    expect(tile("library").kind).toBe("river.column");
    expect(tile("card").source).toBe("tile:river");
    render();
    await until(() => D().render(D().ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "").includes("Library"), "the Library column drawn");
    expect(D().rule).toBe("current");
    // The person's pick in a column is what the card shows (the preview follows the river).
    const lib = (D() as Desk).pane("library") as any;
    await until(() => (lib.items?.length ?? 0) > 1, "the Library's notes", 10_000);
    await mine("tile.focus", {}, "library");
    await mine("column.select", { n: 2 }, "library");
    const card = (D() as Desk).pane("card") as any;
    await until(() => card.msg?.id === lib.flat()[1].m.id, "the card following the Library's pick", 5000);
  }, 20_000);

  test("an agent's tile actions leave the person's focus where it is; its new tab isn't shown over theirs", async () => {
    await mine("layout.load", { name: "terminal-day" });
    D().focus = [...D().names].find(([, v]: any) => v === "middle")[0];
    await act("tile.open", { kind: "reader", name: "helper", where: "tabs" }, "middle");
    expect(get().focus).toBe("middle");
    expect(tile("middle").tabShown).toBe("middle");
    await expect(act("tab.select", {}, "helper")).rejects.toThrow(/the tab the person has/);
    await act("layout.move", { to: "side", where: "down" }, "helper");
    expect(get().focus).toBe("middle");
    await expect(act("tile.close", {}, "middle")).rejects.toThrow(/person's keys/);
    await expect(act("tile.close", {}, "claude")).rejects.toThrow(/an agent doesn't end it/);
    expect(message()).toContain("an agent (tile-agent-413)");
    await act("tile.close", {}, "helper");
  });

  test("ctrl+e in a reader opens the editor in a tile beside it; the draft comes back when the editor exits", async () => {
    const script = join(scratch.root, "door", "fake-editor.sh");
    writeFileSync(script, `#!/bin/sh\nprintf '\\nWritten in the tile.\\n' >> "$1"\n`);
    chmodSync(script, 0o755);
    process.env.EDITOR = script;
    await mine("open", { id: notes.beans.id }, "middle");
    const mid = D().panes.get([...D().names].find(([, v]: any) => v === "middle")[0]);
    await until(() => mid.msg?.id === notes.beans.id && !mid.msg.partial, "beans in middle");
    D().focus = [...D().names].find(([, v]: any) => v === "middle")[0];
    key(ctrl("e"));
    await until(() => !!mid.draft && mid.draft.text.includes("Written in the tile."), "the draft back from the editor tile", 8000);
    expect(get().tiles.some(t => t.name.startsWith("edit"))).toBe(false);   // the tile closed with the editor
    expect(mid.draft.dirty).toBe(true);
    key({ kind: "esc" }); key({ kind: "esc" });
    process.env.EDITOR = "tail -f";
  }, 20_000);
  test("a header's title moves the tile; the bare line after it is the border above, so pressing it resizes the tile", async () => {
    if (!(app as any).stack.includes(desk)) app.push(desk);
    await mine("layout.load", { name: "terminal-day" });
    const before = shape(), n = rect("now"), c = rect("claude");
    // Past the title, on the line: the border between claude and now follows the pointer up. Nothing moves.
    render();
    const end = D().gripEnd(n);
    expect(end).toBeLessThan(n.col + n.cols - 2);
    drag(n.col + n.cols - 3, n.row, n.col + n.cols - 3, n.row - 4);
    expect(shape()).toBe(before);
    expect(D().describe().dragging).toBeNull();
    expect(rect("now").rows).toBe(n.rows + 4);
    expect(rect("claude").rows).toBe(c.rows - 4);
    // The title itself still carries the tile.
    const m = rect("middle");
    drag(n.col + 4, rect("now").row, m.col + 1, m.row + Math.floor(m.rows / 2));
    expect(shape()).not.toBe(before);
    // A header with no border above (the top row) is grip all the way along.
    await mine("layout.load", { name: "terminal-day" });
    const t = rect("claude");
    mouse("down", t.col + t.cols - 3, t.row); mouse("drag", t.col + t.cols - 1, t.row); render();
    expect(D().describe().dragging).toMatchObject({ tile: "claude" });
    key({ kind: "esc" }); mouse("up", t.col + t.cols - 1, t.row);
  });
});
