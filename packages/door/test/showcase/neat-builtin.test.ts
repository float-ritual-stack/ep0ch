import { describe, expect, test } from "bun:test";
import { extensionList, scriptActions } from "../../src/extensions";
import { barSource } from "../../src/bar/source";
import type { Desk } from "../../src/desk/desk";
import { openScreen } from "../../src/desk/screen-specs";
import { USER, type Actor } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: installable neat", () => {
  const h = useShowcaseScreen();

  const press = async (note: string, expected = "links wired", actor: Actor = USER, extra: Record<string, string | boolean> = {}) => {
    const { app } = h;
    const before = new Set(app.describe().messages.map(row => row.id));
    await app.dispatch.act({ action: "button.press", args: { note, label: "neat", ...extra } }, actor);
    const result = () => app.describe().messages.find(row => !before.has(row.id) && /(^|· )neat:/.test(row.message));
    await until(() => !!result(), "neat finished", 10_000).catch(error => { throw new Error(`${error.message}; last messages: ${JSON.stringify(app.describe().messages.slice(-3))}`); });
    expect(result()!.message).toContain(expected);
    h.screen();
  };

  test("the installed button arranges its pages and wires their drawer links", async () => {
    const { app, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "neat" } }, USER);
    h.screen();
    const listed = await h.board.listExtensions(true);
    const neat = listed.extensions.find(e => e.name === "neat" && e.script)!;
    expect(neat).toBeDefined();
    // The script is neat's (PIE-1283): one page, the extension's, and one row in the & list.
    expect(neat.partOf).toBe("neat");
    expect(listed.pages![neat.id]).toBeUndefined();
    expect((await h.board.get(listed.pages!.neat!))!.text).toContain("Follow the script");
    await app.loadExtensions(true);
    const rows = await app.dispatch.act({ action: "bar.open", args: { scope: "&", query: "neat" } }, { kind: "agent", id: "test-agent" }) as { rows: { label: string; detail?: string }[] };
    expect(rows.rows.filter(r => /^neat$/i.test(r.label))).toHaveLength(1);
    expect(rows.rows.find(r => r.label === "Neat")?.detail).toContain("your copy overrides the built-in");
    const parked = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: seeded.notes.scriptTarget.id, name: "parked" } }, USER) as { tile: string };
    await app.dispatch.act({ action: "tile.drawer", tile: parked.tile, args: { on: true } }, USER);
    await press(seeded.notes.neat.id);
    h.screen();
    const layout = await app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>;
    const main = layout.layers.find(l => !l.drawer)!.tiles;
    const a = main.find(t => t.showing?.id === seeded.notes.shed.id)!;
    const b = main.find(t => t.showing?.id === seeded.notes.scriptTarget.id)!;
    expect(layout.layers.find(l => l.drawer)!.tiles.some(t => t.tile === parked.tile)).toBe(true);
    expect(a.collapsed).not.toBe(true);
    expect(b.collapsed).not.toBe(true);
    expect(a.rect!.row).toBe(b.rect!.row);
    expect(a.rect!.col + a.rect!.cols).toBeLessThanOrEqual(b.rect!.col);
    expect(Math.abs(a.rect!.cols - b.rect!.cols)).toBeLessThanOrEqual(1);
    for (const t of layout.layers.filter(l => !l.drawer).flatMap(l => l.tiles).filter(t => t.tile !== a.tile && t.tile !== b.tile && t.shown !== false)) expect(t.collapsed).toBe(true);
    const links = layout.tiles.find(t => t.kind === "backlinks")!;
    expect(links.wires).toEqual(expect.arrayContaining([
      { verb: "select", to: b.tile }, { verb: "open", to: b.tile }, { verb: "alt", to: a.tile },
    ]));
    expect(layout.layers.find(l => l.drawer)!.tiles.some(t => t.tile === links.tile)).toBe(true);
  }, 30_000);

  test("no page slots use this outline's welcome or home and the reader with the keys", async () => {
    const { app, board } = h;
    const current = await board.createBlock(null, "Reading the rain gauge\nThree millimetres overnight.");
    const welcome = await board.createBlock(null, "Garden welcome [welcome::1]\nStart here.");
    const button = await board.createBlock(null, 'Arrange my reading\n::button{label="neat" of=neat}');
    const tile = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: current.id, name: "rain" } }, USER) as { tile: string };
    await app.dispatch.act({ action: "tile.focus", tile: tile.tile }, USER);
    await press(button.id);
    let layout = await app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>;
    const left = layout.tiles.find(t => t.showing?.id === welcome.id)!;
    expect(left).toBeDefined();
    expect(left.collapsed).not.toBe(true);
    expect(layout.tiles.find(t => t.tile === tile.tile)?.showing?.id).toBe(current.id);
    await board.update(welcome.id, "Garden home [page::home]\nStart here.", welcome.revision!, USER);
    await app.dispatch.act({ action: "tile.focus", tile: tile.tile }, USER);
    await press(button.id);
    layout = await app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>;
    const home = layout.tiles.find(t => t.showing?.id === welcome.id)!;
    expect(home).toBeDefined();
    expect(home.collapsed).not.toBe(true);
    expect(home.rect!.col).toBeLessThan(layout.tiles.find(t => t.tile === tile.tile)!.rect!.col);
  }, 30_000);

  test("neat installs by act and the power bar, runs its button, and refuses after uninstall with a reinstall command", async () => {
    const { app, board, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "neat" } }, USER);
    await app.dispatch.act({ action: "extensions.uninstall", args: { id: "neat", demo: "keep" } }, USER);
    await app.loadExtensions(true);
    await until(() => !extensionList()?.extensions.some(e => e.id === "neat"), "neat removed from the door");
    const rows = await app.dispatch.act({ action: "bar.open", args: { scope: "&", query: "neat" } }, { kind: "agent", id: "test-agent" }) as { rows: { label: string; detail?: string }[] };
    expect(rows.rows.find(r => r.label === "install Neat")).toBeDefined();
    // What it adds is the preview's (PIE-1284): the row is one line.
    const source = barSource("extensions")!, row = (await source.rows("neat", null as never, "extensions")).find(r => r.label === "install Neat")!;
    expect(((await source.preview(row, null as never)) as { markdown: string }).markdown).toContain("Adds the script **neat**");
    const installed = await app.dispatch.act({ action: "extensions.install", args: { id: "neat" } }, { kind: "agent", id: "test-agent" }) as { state?: string; page?: string };
    expect(installed.state).toBe("active");
    expect((await board.get(installed.page!))!.text).toContain("Script **neat**");
    const listed = await board.listExtensions(true);
    expect(listed.extensions.find(e => e.id === "neat")?.scripts?.[0]?.name).toBe("neat");
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.some(e => e.id === "neat"), "neat installed in the door");
    await press(seeded.notes.neat.id);
    await app.dispatch.act({ action: "extensions.uninstall", args: { id: "neat", demo: "keep" } }, USER);
    await app.loadExtensions(true);
    await until(() => !extensionList()?.extensions.some(e => e.id === "neat"), "neat removed from the door");
    await expect(app.dispatch.act({ action: "button.press", args: { note: seeded.notes.neat.id, label: "neat" } }, { kind: "agent", id: "test-agent" })).rejects.toThrow("ep0ch act extensions.install id=neat");
    await app.dispatch.press("bar.open", { scope: "&", query: "neat" });
    await until(() => !!app.bar?.items.some(i => i.row.key === "install:neat"), "neat's install row");
    (app as any).paint();
    const plain = (s: string) => s.replace(/\x1b\[[\d;:]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
    const y = h.painted.findIndex(l => plain(l).includes("install Neat"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = plain(h.painted[y]!).indexOf("install Neat") + 2;
    for (let i = 0; i < 2; i++) {
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
    }
    await until(() => !app.bar || app.bar.ended(), "the install pick closes the bar");
    await app.loadExtensions(true);
    expect((await board.listExtensions(true)).extensions.find(e => e.id === "neat")?.state).toBe("active");
    await press(seeded.notes.neat.id);
  }, 40_000);

  /** neat run as the person runs it from the power bar: what it said on the status line. */
  const fromBar = async () => {
    const { app } = h;
    const before = new Set(app.describe().messages.map(row => row.id));
    // The bar's run row ends in the person's own press of the script's action (src/bar/sources.ts, `run <line>`).
    const neat = scriptActions().find(s => s.extension.name === "neat" || s.extension.id === "neat")!;
    expect(neat).toBeDefined();
    await app.dispatch.press(neat.action.name, {});
    const said = () => app.describe().messages.find(row => !before.has(row.id) && /(^|· )neat:/.test(row.message));
    await until(() => !!said(), "neat finished", 10_000).catch(error => { throw new Error(`${error.message}; last messages: ${JSON.stringify(app.describe().messages.slice(-3))}`); });
    return said()!.message;
  };

  test("neat from the power bar on a plain desk, the person's keys in a reader: every step works (PIE-1403)", async () => {
    const { app, board } = h;
    await app.loadExtensions(true);
    const desk = openScreen("desk") as Desk;
    app.push(desk);
    try {
      const note = await board.createBlock(null, "Reading the seed packets\nSow thinly.");
      const r = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: note.id, name: "packets" } }, USER) as { tile: string };
      await app.dispatch.act({ action: "tile.focus", tile: r.tile }, USER);
      const said = await fromBar();
      expect(said).toContain("links wired");
      expect(said).not.toMatch(/t-[0-9a-f]{8}/);
    } finally { app.pop(); }
  }, 30_000);

  test("an outline's own neat script overrides the installed arrangement", async () => {
    const { app, board, seeded } = h;
    await board.createBlock(null, "My neat [script::neat]\n```js\nreturn 'neat: outline wins ' + props.page[0];\n```");
    await app.loadExtensions(true);
    const before = await app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>;
    await press(seeded.notes.neat.id, "outline wins");
    const after = await app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>;
    expect(after.tree).toEqual(before.tree);
  }, 30_000);

  test("a button's repeated slots reach the script whoever presses it, and its alt passes only its own", async () => {
    const { app, board } = h;
    await board.createBlock(null, "Echo slots [script::echo-slots]\n```js\nreturn 'neat: ' + JSON.stringify(props.page);\n```");
    const button = await board.createBlock(null, 'Two pages\n::button{label="neat" of=echo-slots page=meadow page=orchard alt="echo-slots page=pond"}');
    await app.loadExtensions(true);
    await press(button.id, 'neat: ["meadow","orchard"]');
    await press(button.id, 'neat: ["meadow","orchard"]', { kind: "agent", id: "test-agent" });
    await press(button.id, 'neat: ["pond"]', USER, { alt: true });
  }, 30_000);
});
