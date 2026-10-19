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
import { litCells } from "../src/bar/filter";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("a tile's menu (PIE-492)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  // Tall enough for a reader's whole menu (every note and reader row, grouped) to open below a right-click near its top.
  const info = { cols: 160, rows: 64, cellW: 9, cellH: 16, kitty: false };
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

  test("a frame card leaves focus alone and its zoom row runs the menu's action", async () => {
    fresh();
    await mine("tile.focus", {}, "reader");
    render();
    const r = rect("activity");
    const frame = render().lines.map(visible)[r.row]!;
    const x = frame.indexOf("⋯", r.col);
    expect(x).toBeGreaterThan(r.col);
    press(x, r.row);
    expect(get().focus).toBe("reader");
    expect(D().hintGet().cards[0].choices.find((c: any) => c.act.action === "tile.zoom")).toBeDefined();
    const lines = render().lines.map(visible);
    const zoomAt = lines.findIndex(l => l.includes("[ctrl][w] [z] zoom"));
    expect(zoomAt).toBeGreaterThan(-1);
    press(lines[zoomAt]!.indexOf("zoom"), zoomAt);
    await until(() => get().zoom === "activity" || !!D().zoom, "zoom ran from the frame card");
    expect(D().hintGet().cards).toEqual([]);
    const again = await act("tile.menu", {}, "activity") as { rows: MenuRow[] };
    expect(again.rows.find(x => x.action === "tile.zoom")?.label).toBe("unzoom");
    await mine("tile.zoom", { on: false }, "activity");
  });

  test("a right-click in a reader opens the menu at the pointer; ↓ and ⏎ run a row, a row's own key runs it, esc and a click outside put it away", async () => {
    fresh();
    await until(() => !!D().pane("reader")?.msg, "the reader shows a note");
    render();
    const r = rect("reader");
    press(r.col + 5, r.row + 3, 2);
    await until(() => menu()?.name === "tile menu", "a right-click opens the menu");
    expect(get().focus).toBe("reader");
    // Its box's top left corner is at the pointer.
    expect(render().lines.map(visible)[r.row + 3]!.slice(r.col + 5)).toMatch(/^┌/);
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

  test("typing in the menu filters it (PIE-879): the power bar's matcher, the query on the top row, empty groups gone; backspace widens, esc clears then closes, ⏎ runs the top row", async () => {
    fresh();
    await until(() => !!D().pane("reader")?.msg, "the reader shows a note");
    render();
    key(ctrl("w")); key(char("."));
    await until(() => menu()?.name === "tile menu", "^W . opens it");
    const all = menu()!.items.length;
    expect(all).toBeGreaterThan(8);
    expect(screen()).toContain("type to filter");
    // Letters are the query, not rows' keys: "f" would have been ^W f's float only after a ^W; "e" is the reader's edit key.
    for (const c of "zoom") key(char(c));
    const rows = () => menu()!.items.map(r => r.action);
    expect(rows()).toContain("tile.zoom");
    expect(rows().length).toBeLessThan(all);
    expect(screen()).toContain("zoom");
    expect(rows().every(a => !a.startsWith("edit"))).toBe(true);
    // The query is on the box's top row, and the groups left are the ones with rows.
    const lines = render().lines.map(visible);
    const top = lines.findIndex(l => l.includes("┌─ reader"));
    expect(lines[top + 1]).toContain("zoom");
    const groups = [...new Set(menu()!.items.map(r => r.group))];
    expect(groups.length).toBeLessThan(4);
    // A query nothing matches says so; backspace widens it.
    for (const c of "qq") key(char(c));
    expect(menu()!.items.length).toBe(0);
    expect(screen()).toContain("no row matches");
    key({ kind: "backspace" }); key({ kind: "backspace" });
    expect(rows()).toContain("tile.zoom");
    // Esc clears the query first (the menu stays, whole again), then puts the menu away.
    key({ kind: "esc" });
    expect(menu()?.items.length).toBe(all);
    key({ kind: "esc" });
    expect(menu()).toBeNull();
    // Esc with a ^W pending clears the query and the pending chord: the next key is a letter for the query, not ^W's.
    key(ctrl("w")); key(char("."));
    await until(() => menu()?.name === "tile menu", "open for the chord");
    key(char("z")); key(ctrl("w")); key({ kind: "esc" }); key(char("x"));
    expect(menu()?.name).toBe("tile menu");
    expect(treeNames()).toContain("reader");
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(menu()).toBeNull();
    // ⏎ runs the top row of what's left; a chord still runs its row from a typed query.
    key(ctrl("w")); key(char("."));
    await until(() => menu()?.name === "tile menu", "open again");
    for (const c of "zoom") key(char(c));
    const topRow = menu()!.items[0]!;
    key({ kind: "enter" });
    await until(() => menu() === null, "⏎ ran the top row");
    expect(topRow.action).toBe("tile.zoom");
    expect(D().zoom).not.toBeNull();
    await mine("tile.zoom", { on: false }, "reader");
    key(ctrl("w")); key(char("."));
    await until(() => menu()?.name === "tile menu", "open again");
    key(char("z")); key(ctrl("w")); key(char("f"));
    await until(() => menu() === null, "^W f ran the float row from a typed query");
    await mine("tile.float", {}, "reader");
    // A click on a row still works while filtered.
    key(ctrl("w")); key(char("."));
    await until(() => menu()?.name === "tile menu", "open again");
    for (const c of "zoo") key(char(c));
    const ls = render().lines.map(visible), y = ls.findIndex(l => l.includes(" zoom ")), x = ls[y]!.indexOf("zoom");
    press(x, y);
    await until(() => D().zoom !== null && menu() === null, "a click on the filtered row ran it");
    await mine("tile.zoom", { on: false }, "reader");
  });

  test("a menu taller than the screen scrolls with its foot always shown (PIE-1036): at 40 rows, wheel, arrows and a thumb reach the last row", async () => {
    info.rows = 40;
    try {
      fresh();
      await until(() => !!D().pane("reader")?.msg, "the reader shows a note");
      render();
      key(ctrl("w")); key(char("."));
      await until(() => menu()?.name === "tile menu", "^W . opens it");
      const rows = menu()!.items as readonly MenuRow[];
      const lines = () => render().lines.map(visible);
      const draw = () => lines().slice(0, 40);
      const last = rows.at(-1)!;
      // The box stays on the screen with its foot (its bottom border and hint), whatever the rows' count.
      const box = () => { const l = draw(); const t = l.findIndex(x => x.includes("┌─ reader")); const b = l.findIndex((x, i) => i > t && x.includes("type to filter")); return { t, b, l }; };
      expect(box().t).toBeGreaterThanOrEqual(0);
      expect(box().b).toBeGreaterThan(box().t);
      // The wheel scrolls the rows, not only the cursor: the rest of the menu comes into view and the foot stays.
      const first = box().l.join("\n");
      expect(first).not.toContain(last.label + " ");
      for (let n = 0; n < 40; n++) key({ kind: "mouse", action: "wheel-down", button: 0, x: 5, y: 5 });
      expect(box().l.join("\n")).toContain(last.label);
      expect(box().b).toBeGreaterThan(box().t);
      // A thumb on the box's right border says there is more, and the cursor is on a row in view, never off the screen.
      const edge = () => { const { t, b, l } = box(); const x = l[t]!.indexOf("┐", l[t]!.indexOf("┌─ reader")); return l.slice(t + 1, b).map(r => [...r][x]); };
      expect(edge()).toContain("█");
      expect(box().l.join("\n")).toContain(menu()!.items[(menu() as any).sel]!.label);
      // Arrows reach the last row too, and ⏎ runs it.
      key({ kind: "esc" });
      key(ctrl("w")); key(char("."));
      await until(() => menu()?.name === "tile menu", "open again");
      for (let n = 0; n < rows.length; n++) key({ kind: "down" });
      expect(box().l.join("\n")).toContain(last.label);
      key({ kind: "esc" });
    } finally { info.rows = 64; }
  });

  test("the letters a query matches are lit: a word where it sits, else its letters in order", () => {
    expect([...litCells("preview beside", "view")]).toEqual([3, 4, 5, 6]);
    expect([...litCells("fold to a spine", "fsp")].sort((a, b) => a - b)).toEqual([0, 10, 11]);
    expect([...litCells("float", "xyz")]).toEqual([]);
    expect([...litCells("😀 Open", "open")]).toEqual([2, 3, 4, 5]);
    expect([...litCells("tune its look", "tune look")].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 9, 10, 11, 12]);
  });

  test("an agent's tile.menu q=<text> answers the rows that match, and how many there are", async () => {
    fresh();
    await until(() => !!D().pane("reader")?.msg, "the reader shows a note");
    const out = await act("tile.menu", { q: "zoom" }, "reader") as { rows: MenuRow[]; of: number };
    expect(out.rows.map(r => r.action)).toContain("tile.zoom");
    expect(out.rows.length).toBeLessThan(out.of);
    expect(menu()).toBeNull();
    // The person's, opened with a query typed.
    await mine("tile.menu", { q: "zoom" }, "reader");
    await until(() => menu()?.name === "tile menu", "the menu opens");
    expect(menu()!.items.map(r => r.action)).toContain("tile.zoom");
    expect(menu()!.items.length).toBe(out.rows.length);
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(menu()).toBeNull();
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

  test("a terminal tile: its menu has its own rows; a right-click goes to a program that asked for the mouse, and the frame still opens its card", async () => {
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
    expect(D().hintGet().cards[0].choices.some((c: any) => c.act.action === "tile.enter")).toBe(true);
    key({ kind: "esc" });
    // Closing ends its program: asked twice.
    await mine("tile.close", {}, "mousy").catch(() => {}); await mine("tile.close", {}, "mousy");
  });
});
