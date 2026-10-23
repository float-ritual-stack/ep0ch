import { describe, expect, test } from "bun:test";
import type { Desk } from "../../src/desk/desk";
import { USER, type Actor } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: built-in neat", () => {
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

  test("the bundled button arranges its pages and wires their drawer links", async () => {
    const { app, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "neat" } }, USER);
    h.screen();
    const listed = await h.board.listExtensions(true);
    const neat = listed.extensions.find(e => e.name === "neat" && e.script)!;
    expect(neat).toBeDefined();
    expect((await h.board.get(listed.pages![neat.id]!))!.text).toContain("Follow the script");
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

  test("an outline's own neat script overrides the bundled arrangement", async () => {
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
