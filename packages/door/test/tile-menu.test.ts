// PIE-492: a tile's menu. The ⋯ in its header, a right-click in it, ^W . and `tile.menu` open it; its rows are what the
// dispatcher would run in that tile (each action's `menu` rows), and one click, ⏎ or a row's own key runs it as the
// person. An agent gets the rows as data and nothing is drawn over the person's screen. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { leaves } from "../src/desk/screen-layout";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { MenuRow } from "../src/surface/dispatch";
import { declaredKeys } from "../src/surface/actions";
import { visible } from "../src/style";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("a tile's menu (PIE-492)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const info = { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false };
  const AS = "menu-agent-492";
  const D = () => desk as any;
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => app.act({ action, args, tile, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => D().dispatch.act({ action, args, tile }, { kind: "user" });
  const message = () => (app as any).message as string;
  const render = () => desk.render(D().ctx);
  const screen = () => render().lines.map(visible).join("\n");
  const get = () => D().layoutGet() as { tree: any; focus: string; tiles: any[]; floats: any[]; zoom?: string | null };
  const rect = (name: string) => get().tiles.find(t => t.name === name)!.rect as { col: number; row: number; cols: number; rows: number };
  const treeNames = () => (leaves(D().root) as number[]).map((id: number) => D().nameOf(id)) as string[];
  const menu = () => D().overlays.top() as { name: string; items: readonly MenuRow[]; sel: number } | null;
  const press = (x: number, y: number, button = 0) => { key({ kind: "mouse", action: "down", button, x, y }); key({ kind: "mouse", action: "up", button, x, y }); };
  const fresh = (layout = "desk") => {
    if ((app as any).stack.at(-1) instanceof Desk) { D().dispose(); app.pop(); }
    desk = new Desk(undefined, { layout });
    app.push(desk);
    render();
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { D()?.dispose(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("an agent's tile.menu answers the rows the dispatcher would run there, and draws nothing", async () => {
    fresh();
    await until(() => !!D().pane("reader")?.msg, "the reader shows a note");
    await mine("tile.focus", {}, "activity");
    const out = await act("tile.menu", {}, "reader") as { tile: string; rows: MenuRow[] };
    expect(out.tile).toBe("reader");
    const groups = [...new Set(out.rows.map(r => r.group))];
    expect(groups.slice(0, 1)).toEqual(["Tile"]);
    expect(groups).toContain("Note");
    const by = (action: string) => out.rows.find(r => r.action === action);
    expect(by("tile.close")).toMatchObject({ label: "close", key: "ctrl+w x", tile: expect.stringMatching(/^t\d+$/) });
    expect(by("tile.float")).toMatchObject({ label: "float", key: "ctrl+w f" });
    expect(by("edit")).toMatchObject({ group: "Note", key: "e" });
    expect(by("note.copy")).toMatchObject({ group: "Note", label: "copy note", key: "Y" });
    // Back has nothing to go back to yet: not in the menu.
    expect(by("back")).toBeUndefined();
    // $EDITOR on a draft is a row only while one is being written.
    expect(by("edit.external")).toBeUndefined();
    // Each row's key is one its action declares (the keycap is the action's own key).
    for (const r of out.rows) if (r.key) expect(declaredKeys(D().dispatch.list().actions.find((a: any) => a.name === r.action)?.keys).has(r.key)).toBe(true);
    // Nothing drawn, the person's keys where they were.
    expect(menu()).toBeNull();
    expect(get().focus).toBe("activity");
  });

  test("in an edit, the menu's edit in $EDITOR is ctrl+x ctrl+e (edit.external), the person's only", async () => {
    fresh();
    await until(() => !!D().pane("reader")?.msg, "the reader shows a note");
    await mine("edit", {}, "reader");
    const out = await act("tile.menu", {}, "reader") as { rows: MenuRow[] };
    expect(out.rows.find(r => r.action === "edit.external")).toMatchObject({ label: "edit in $EDITOR", group: "Note", key: "ctrl+x ctrl+e" });
    expect(out.rows.find(r => r.action === "edit")).toBeUndefined();
    await expect(act("edit.external", {}, "reader")).rejects.toThrow(/person's terminal/);
    await mine("edit.close", {}, "reader");
  });

  test("a click on a tile's ⋯ opens its menu under it; one click on a row runs it as the person", async () => {
    fresh();
    await mine("tile.focus", {}, "reader");
    render();
    const r = rect("activity");
    const b = (D().menuButtons as any[]).find(x => D().nameOf(x.id) === "activity");
    // Left of the ×: ⋯ ×.
    expect(b).toMatchObject({ row: r.row, from: r.col + r.cols - 4 });
    expect(screen().split("\n")[r.row]!.slice(r.col + r.cols - 4, r.col + r.cols - 1)).toBe("⋯─×");
    press(b.from, b.row);
    await until(() => menu()?.name === "tile menu", "the menu opens");
    expect(get().focus).toBe("activity");
    // Drawn under the ⋯, its title the tile's name.
    expect(screen()).toContain(" activity ");
    const lines = render().lines.map(visible);
    const zoomAt = lines.findIndex(l => /\bzoom\b/.test(l) && l.includes("^W z"));
    expect(zoomAt).toBeGreaterThan(r.row);
    const x = lines[zoomAt]!.indexOf("zoom");
    press(x, zoomAt);
    await until(() => get().zoom === "activity" || !!D().zoom, "zoom ran from the menu");
    expect(menu()).toBeNull();
    // It's an action: unzoom is the same row, relabelled.
    const again = await act("tile.menu", {}, "activity") as { rows: MenuRow[] };
    expect(again.rows.find(x => x.action === "tile.zoom")?.label).toBe("unzoom");
    await mine("tile.zoom", { on: false }, "activity");
  });

  test("a right-click in a reader opens the menu at the pointer; ↓ and ⏎ run a row, a row's own key runs it, esc and a click outside put it away", async () => {
    fresh();
    await until(() => !!D().pane("reader")?.msg, "the reader shows a note");
    render();
    const r = rect("reader");
    press(r.col + 5, r.row + 6, 2);
    await until(() => menu()?.name === "tile menu", "a right-click opens the menu");
    expect(get().focus).toBe("reader");
    // Its box's top left corner is at the pointer.
    expect(render().lines.map(visible)[r.row + 6]!.slice(r.col + 5)).toMatch(/^┌/);
    // ^W f is the float row's own key.
    key(ctrl("w")); key(char("f"));
    await until(() => get().floats.some(f => f.tile === "reader" || f.name === "reader") || D().floats.length > 0, "^W f in the menu floats the reader");
    expect(menu()).toBeNull();
    await mine("tile.float", {}, "reader");
    // ^W . on the focused tile; ↓ to a row and ⏎ runs it.
    key(ctrl("w")); key(char("."));
    await until(() => menu()?.name === "tile menu", "^W . opens it");
    const m = menu()!;
    const i = m.items.findIndex(x => x.action === "tile.zoom");
    for (let n = 0; n < i; n++) key({ kind: "down" });
    key({ kind: "enter" });
    await until(() => D().zoom !== null, "⏎ ran zoom");
    await mine("tile.zoom", { on: false }, "reader");
    // esc puts it away; so does a click outside it, which does nothing else.
    key(ctrl("w")); key(char("."));
    await until(() => menu() !== null, "open again");
    key({ kind: "esc" });
    expect(menu()).toBeNull();
    key(ctrl("w")); key(char("."));
    await until(() => menu() !== null, "open again");
    const before = treeNames();
    render();
    press(1, 46);
    expect(menu()).toBeNull();
    expect(treeNames()).toEqual(before);
  });

  test("a row that would be refused is dimmed with why; choosing it says why and does nothing", async () => {
    fresh();
    await mine("layout.lock", { on: true });
    const out = await act("tile.menu", {}, "activity") as { rows: MenuRow[] };
    const close = out.rows.find(r => r.action === "tile.close")!;
    expect(close.refused).toMatch(/lock/);
    await mine("tile.menu", {}, "activity");
    const m = menu()!;
    m.sel = m.items.findIndex(x => x.action === "tile.close");
    render();
    expect(screen()).toMatch(/✕ [\s\S]*lock/);
    key({ kind: "enter" });
    await until(() => /lock/.test(message()), "the refusal is said");
    expect(treeNames()).toContain("activity");
    await mine("layout.lock", { on: false });
  });

  test("a terminal tile: its menu has its own rows; a right-click goes to a program that asked for the mouse, and the ⋯ still opens the menu", async () => {
    fresh();
    // A program that asks for the mouse (mode 1000 and SGR 1006), then waits.
    await mine("tile.open", { kind: "pty", name: "mousy", cmd: "sh -c \"printf '\\033[?1000h\\033[?1006h'; sleep 30\"" }, "reader");
    await until(() => D().pane("mousy")?.wantsMouse?.() === true, "the program asked for the mouse");
    const out = await act("tile.menu", {}, "mousy") as { rows: MenuRow[] };
    expect(out.rows.find(r => r.action === "tile.enter")).toMatchObject({ group: "Terminal", label: "type in it", key: "e" });
    expect(out.rows.find(r => r.action === "tile.close")?.label).toMatch(/^close \(ends /);
    render();
    const r = rect("mousy");
    press(r.col + 4, r.row + 3, 2);
    await new Promise(res => setTimeout(res, 50));
    expect(menu()).toBeNull();
    const b = (D().menuButtons as any[]).find(x => D().nameOf(x.id) === "mousy");
    press(b.from, b.row);
    await until(() => menu()?.name === "tile menu", "the ⋯ opens the terminal's menu");
    key({ kind: "esc" });
    // Closing ends its program: asked twice.
    await mine("tile.close", {}, "mousy").catch(() => {}); await mine("tile.close", {}, "mousy");
  });
});
