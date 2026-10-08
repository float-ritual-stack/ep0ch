// PIE-506 on the desk: what its keys and clicks did by themselves is an action now, and an agent's run of
// it never takes the person's focus, selection or keys. Search answers an agent's query without opening the
// overlay; going into a terminal or the drawer is the person's only; a list tile's pick by an agent
// moves nothing of theirs; ^W then a ctrl+letter isn't the letter. Scratch services, fictional notes, `sh`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { traceActions, type ActionRun } from "../src/surface/actions";
import { PTY_ACTIONS } from "../src/desk/pty-actions";
import { TILE_ACTIONS } from "../src/desk/tile-actions";
import { serviceKind, tileKind } from "../src/desk/tile-kinds";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("the desk's keys are actions, and agents' runs of them leave the person's keys alone", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const AS = "parity-agent-506";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  const get = () => D().layoutGet() as { focus: string; tiles: any[] };
  const ran = async (k: Key) => { const runs: ActionRun[] = []; const stop = traceActions(r => runs.push(r)); try { key(k); await Bun.sleep(20); } finally { stop(); } return runs.map(r => r.name); };
  const notes: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    process.env.EDITOR = "true";
    delete process.env.VISUAL;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const mk = async (text: string, parentId: string | null = null) => board.request<any>("create", { parentId, text, author: "agent" });
    notes.orchard = await mk("Orchard rota\nWho prunes which row.");
    notes.pears = await mk("Prune the pears\nAfter the frost.", notes.orchard.id);
    notes.plums = await mk("Thin the plums\nOne every hand-span.", notes.orchard.id);
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    desk.render(D().ctx);
    await until(() => D().panes.size > 0 && get().tiles.length >= 4, "the desk's tiles");
  }, 30_000);

  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EDITOR"]) delete process.env[k];
  });

  test("search: an agent's query answers the hits and opens nothing; the person's / opens the power bar's notes scope, and ⏎ there runs open", async () => {
    const focus = get().focus;
    const r = await act("search", { query: "Prune the pears" }) as any;
    expect(r.hits.some((h: any) => h.id === notes.pears.id)).toBe(true);
    expect((app as any).bar).toBeNull();
    expect(get().focus).toBe(focus);
    await expect(act("search", { query: "p" })).rejects.toThrow(/at least 2 characters/);
    expect(await ran(char("/"))).toEqual(["search", "bar.open"]);
    expect((app as any).bar.scope).toBe("notes");
    expect(app.person().busy).toBe(true);
    for (const c of "Thin the plums") key(char(c));
    await until(() => (app as any).bar.items.length > 0, "the search hits", 5000);
    expect(await ran({ kind: "enter" })).toEqual(["bar.pick", "open"]);
    await until(() => desk.current?.id === notes.plums.id, "the plums note opened");
    expect((app as any).bar).toBeNull();
  });

  test("a list tile's pick: the person's moves the selection; an agent's answers the row and moves nothing", async () => {
    await act("open", { id: notes.orchard.id });
    await until(() => (D().panes as Map<number, any>).values().some((p: any) => p.kind === "thread" && p.replies().length === 2), "the thread's replies");
    const thread = [...(D().panes as Map<number, any>).values()].find((p: any) => p.kind === "thread");
    const r = await act("thread.pick", { n: 2 }) as any;
    expect(r.id).toBe(notes.plums.id);
    expect(thread.selected).toBe(0);
    await D().dispatch.act({ action: "thread.pick", args: { n: 2 } }, { kind: "user" });
    expect(thread.selected).toBe(1);
  });

  test("tile.enter and tile.leave are the person's: an agent's is refused, with the way it does it instead", async () => {
    await D().dispatch.act({ action: "tile.open", args: { kind: "pty", name: "shell" } }, { kind: "user" });
    await until(() => get().tiles.find((t: any) => t.name === "shell")?.terminal?.running, "the shell");
    await expect(act("tile.enter", {}, "shell")).rejects.toThrow(/tile\.type/);
    await D().dispatch.act({ action: "tile.focus", args: {}, tile: "shell" }, { kind: "user" });
    expect(await ran(char("e"))).toEqual(["tile.enter"]);
    expect(D().rawKeys()).toBe(true);
    await expect(act("tile.leave")).rejects.toThrow(/keys are theirs/);
    expect(D().rawKeys()).toBe(true);
    expect(await ran(ctrl("]"))).toEqual(["tile.leave"]);
    expect(D().rawKeys()).toBe(false);
  });

  test("a terminal's actions are its kind's (PIE-510): keys, a click and act reach them through the registry", async () => {
    expect(TILE_ACTIONS.has("tile.type")).toBe(false);
    expect(tileKind("pty")?.actions).toBe(PTY_ACTIONS);
    // A program an extension names is a terminal too: it shares them.
    const prog = serviceKind({ kind: "orchard.counter", about: "counts rows", program: { command: ["sh"], cwd: "/", env: {}, args: {}, label: "counter" } });
    expect(prog.inherits).toContain(PTY_ACTIONS);
    // The shell has the keys (the test above left it): an agent's tile.type with no reader goes to it.
    expect(get().focus).toBe("shell");
    expect((await act("tile.type", { text: "echo kind-typed\\n" }) as any).tile).toBe("shell");
    await expect(act("tile.restart", {}, "shell")).rejects.toThrow(/shell is still running/);
    const other = get().tiles.find((t: any) => t.kind === "reader" || t.kind === "tree").name;
    await expect(act("tile.type", { text: "x" }, other)).rejects.toThrow(new RegExp(`${other} is an? \\w+ tile: tile.type is for a terminal tile`));
    await expect(act("tile.type", { text: "x" }, "no-such-tile")).rejects.toThrow(/no tile no-such-tile/);
    // A click inside it runs tile.enter, as e does, by its kind's press.
    const r = get().tiles.find((t: any) => t.name === "shell").rect;
    const runs: ActionRun[] = [];
    const stop = traceActions(x => runs.push(x));
    try { key({ kind: "mouse", action: "down", button: 0, x: r.col + 3, y: r.row + 2 }); key({ kind: "mouse", action: "up", button: 0, x: r.col + 3, y: r.row + 2 }); await Bun.sleep(20); } finally { stop(); }
    expect(runs.filter(x => x.name === "tile.enter").map(x => x.scope)).toEqual(["terminal"]);
    expect(D().rawKeys()).toBe(true);
    await D().dispatch.act({ action: "tile.leave", args: {} }, { kind: "user" });
    expect(D().rawKeys()).toBe(false);
  });

  test("a terminal's ⏎ runs tile.enter; an agent's tile.type with no reader never guesses between terminals", async () => {
    await D().dispatch.act({ action: "tile.focus", args: {}, tile: "shell" }, { kind: "user" });
    expect(await ran({ kind: "enter" })).toEqual(["tile.enter"]);
    expect(await ran(ctrl("]"))).toEqual(["tile.leave"]);
    await D().dispatch.act({ action: "tile.open", args: { kind: "pty", name: "shell2" } }, { kind: "user" });
    await until(() => get().tiles.find((t: any) => t.name === "shell2")?.terminal?.running, "the second shell");
    const other = get().tiles.find((t: any) => t.kind === "reader" || t.kind === "tree").name;
    await D().dispatch.act({ action: "tile.focus", args: {}, tile: other }, { kind: "user" });
    // The person's keys are on neither terminal: which one would be a guess, so the agent names it.
    await expect(act("tile.type", { text: "x" })).rejects.toThrow(/tile\.type needs tile=<tile>: .*shell, shell2/);
    expect((await act("tile.type", { text: "echo named\\n" }, "shell2") as any).tile).toBe("shell2");
    await D().dispatch.act({ action: "tile.close", args: { confirm: true }, tile: "shell2" }, { kind: "user" }).catch(() => {});
  });

  test("^W then a ctrl+letter isn't the letter: ^W ctrl+x closes nothing", async () => {
    const n = get().tiles.length;
    key(ctrl("w")); key(ctrl("x"));
    await Bun.sleep(20);
    expect(get().tiles.length).toBe(n);
    expect(D().prefix).toBe("");
  });

  test("q and V on the desk are the shell's actions: screen.back, video.cycle", async () => {
    expect(await ran(char("V"))).toEqual(["video.cycle"]);
    expect(await ran(char("q"))).toEqual(["screen.back"]);
    expect((app as any).stack.at(-1)).toBeInstanceOf(MainMenu);
  });

  test("the drawer: going in is the person's only", async () => {
    await expect(app.act({ action: "host.enter", args: {}, as: AS })).rejects.toThrow(/person's keys/);
    await expect(app.act({ action: "host.leave", args: {}, as: AS })).rejects.toThrow(/keys are theirs/);
  });
});
