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
    // Installed as it ships: it reads as installed, its own words on the row, never "your copy overrides" (PIE-1399).
    expect(rows.rows.find(r => r.label === "Neat")?.detail).not.toContain("overrides");
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

  test("a script line typed in the power bar and run with ⏎: ctrl+z puts the layout back with the bar still open and the answer kept (PIE-1230)", async () => {
    const { app, board } = h;
    await app.loadExtensions(true);
    const desk = openScreen("desk") as Desk;
    app.push(desk);
    try {
      const open = async (title: string, name: string) => {
        const note = await board.createBlock(null, `${title}\nBody.`);
        return (await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: note.id, name } }, USER) as { tile: string }).tile;
      };
      await open("Reading the gate log", "gate");
      const second = await open("Reading the path log", "path");
      await app.dispatch.act({ action: "tile.focus", tile: second }, USER);
      const seen = new Set(app.describe().messages.map(m => m.id));
      h.press({ kind: "char", ch: "k", ctrl: true });
      for (const c of "neat") h.ch(c);
      await app.bar!.settled();
      h.press({ kind: "enter" });
      await until(() => app.describe().messages.some(m => !seen.has(m.id) && /(^|· )neat:/.test(m.message)), "neat finished", 10_000);
      // The status line says ctrl+z undoes, and the bar is still open on the line with its answer: that key is the undo.
      expect(app.bar && !app.bar.ended()).toBe(true);
      h.press({ kind: "char", ch: "z", ctrl: true });
      await until(() => !app.bar, "ctrl+z puts the bar away and takes the run back");
      await Bun.sleep(100);
      expect(app.describe().messages.some(m => m.action === "layout.undo" && m.message.includes("put the layout back"))).toBe(true);
    } finally { app.pop(); }
  }, 30_000);

  test("a typed neat line, ctrl+z with the bar open: the layout tree is what it was before the run, run after run (PIE-1230)", async () => {
    const { app, board } = h;
    await app.loadExtensions(true);
    const desk = openScreen("desk") as Desk;
    app.push(desk);
    try {
      const open = async (title: string, name: string) => {
        const note = await board.createBlock(null, `${title}\nBody.`);
        return (await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: note.id, name } }, USER) as { tile: string }).tile;
      };
      await open("Reading the gate log", "reader");
      await open("Reading the path log", "exhibit");
      // A links tile in the drawer, as the showcase door has: neat wires its pages to it, and the person's keys go there.
      const links = await app.dispatch.act({ action: "tile.open", args: { kind: "backlinks", name: "links" } }, USER) as { tile: string };
      await app.dispatch.act({ action: "tile.drawer", tile: links.tile, args: { on: true } }, USER);
      // The tree as names and nesting, shares and ids aside: what a person sees arranged.
      const shape = async () => {
        const l = await app.dispatch.act({ action: "layout.get" }, USER) as { tree: unknown };
        const walk = (n: any): string => n.kids ? `${n.split}(${n.kids.map(walk).join(" ")})` : String(n.name).replace(/\d+$/, "");
        return walk(l.tree);
      };
      const drawer = app.drawer as any;
      drawer.goTo(drawer.desk.pane("links"), USER);   // the drawer open, as the door's is once neat has put a tile there
      await app.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
      const start = await shape();
      for (const round of [1, 2, 3]) {
        const seen = new Set(app.describe().messages.map(m => m.id));
        // neat's links step aims a links tile that is already in the drawer, and the person's keys go there (the pane: typing in drawer:backlinks).
        const tile = drawer.desk.tileOutline().map((t: { name: string }) => t.name).findLast((n: string) => /^(replies|backlinks)\d*$/.test(n));
        if (tile) drawer.goTo(drawer.desk.pane(tile), USER);
        h.press({ kind: "char", ch: "k", ctrl: true });
        for (const c of 'neat page="[[Bike shed]]" right=%exhibit') h.ch(c);
        await app.bar!.settled();
        h.press({ kind: "enter" });
        await until(() => app.describe().messages.some(m => !seen.has(m.id) && /(^|· )neat:/.test(m.message)), `neat finished (round ${round})`, 10_000);
        const ran = await shape();
        expect(ran).not.toBe(start);
        h.press({ kind: "char", ch: "z", ctrl: true });
        await until(() => !app.bar, "ctrl+z puts the bar away");
        await Bun.sleep(150);
        expect([round, await shape()]).toEqual([round, start]);
      }
      // The person's own ctrl+z on the desk, after the bar was put away with Esc, takes the next run back as it always did.
      const seen = new Set(app.describe().messages.map(m => m.id));
      h.press({ kind: "char", ch: "k", ctrl: true });
      for (const c of 'neat page="[[Bike shed]]" right=%exhibit') h.ch(c);
      await app.bar!.settled();
      h.press({ kind: "enter" });
      await until(() => app.describe().messages.some(m => !seen.has(m.id) && /(^|· )neat:/.test(m.message)), "neat finished (esc round)", 10_000);
      h.press({ kind: "esc" });
      await until(() => !app.bar, "esc puts the bar away");
      h.press({ kind: "char", ch: "z", ctrl: true });
      await Bun.sleep(300);
      expect(await shape()).toBe(start);
    } finally { app.pop(); }
  }, 60_000);

  const floating = async (tile: string) => (await h.app.dispatch.act({ action: "layout.get" }, USER) as ReturnType<Desk["layoutAll"]>).tiles.find(t => t.tile === tile)?.float;

  test("typed as its row reads, run neat is the first row: the action before any note named Neat (PIE-1403)", async () => {
    const { app } = h;
    await app.loadExtensions(true);
    h.press({ kind: "char", ch: "k", ctrl: true });
    try {
      for (const c of "run neat") h.ch(c);
      await app.bar!.settled();
      const first = app.bar!.items[0]!;
      expect([first.source.id, first.row.label, first.row.refused]).toEqual(["actions", "run neat", undefined]);
      expect(app.bar!.items.some(i => i.source.id === "notes" && /neat/i.test(i.row.label))).toBe(true);   // the notes still listed, after it
    } finally { h.press({ kind: "esc" }); h.press({ kind: "esc" }); }
  }, 30_000);

  test("neat's row and page read as neat: its own words, never its action's id or its name twice (PIE-1405)", async () => {
    const { app } = h;
    await app.loadExtensions(true);
    h.press({ kind: "char", ch: "k", ctrl: true });
    try {
      for (const c of ">neat") h.ch(c);
      await app.bar!.settled();
      const it = app.bar!.items.find(i => i.source.id === "actions" && i.row.label === "neat")!;
      expect(it).toBeDefined();
      expect(it.row.detail).not.toMatch(/^neat:/i);
      const page = await it.source.preview(it.row, (app.bar as any).host) as { markdown: string };
      const head = page.markdown.split("\n")[0]!;
      expect(head).toStartWith("**neat** · ");
      expect(head).not.toMatch(/ext\.script-|· neat ·/);
    } finally { h.press({ kind: "esc" }); h.press({ kind: "esc" }); }
  }, 30_000);

  test("neat from a float, and from a river column: it works or says in plain words what it couldn't do (PIE-1403)", async () => {
    const { app, board } = h;
    const shed = await board.createBlock(null, "The shed\nWhat's in it, and what it needs.");
    const note = await board.createBlock(shed.id, "Plan the cold frame\nGlass from the old shed.");
    const desk = openScreen("desk") as Desk;
    app.push(desk);
    try {
      const r = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: note.id, name: "frame" } }, USER) as { tile: string };
      await app.dispatch.act({ action: "tile.float", tile: r.tile }, USER);
      await app.dispatch.act({ action: "tile.focus", tile: r.tile }, USER);
      expect(await floating(r.tile)).toBe(true);
      const said = await fromBar();
      expect(said).not.toMatch(/t-[0-9a-f]{8}|Error:|…$/);
      expect(said).toContain("links wired");
    } finally { app.pop(); }
    const river = openScreen("river") as Desk;
    app.push(river);
    try {
      const o = await app.act({ action: "open", args: { id: note.id }, as: "test-agent" }) as { name: string };
      await app.dispatch.act({ action: "tile.focus", tile: o.name }, USER);
      let said = await fromBar();
      expect(said).not.toMatch(/t-[0-9a-f]{8}|Error:/);
      // A reader floating over the river (a new note's float is one), the person's keys in it.
      const made = await app.dispatch.act({ action: "tile.open", args: { kind: "reader", mode: "held", note: note.id, name: "glass" } }, USER) as { tile: string };
      await app.dispatch.act({ action: "tile.float", tile: made.tile }, USER);
      await app.dispatch.act({ action: "tile.focus", tile: made.tile }, USER);
      expect(await floating(made.tile)).toBe(true);
      said = await fromBar();
      expect(said).not.toMatch(/t-[0-9a-f]{8}|Error:/);
      expect(made).toBeDefined();
    } finally { app.pop(); }
  }, 30_000);

  // PIE-1230 / PIE-1253: Evan types `neat page=[[a]] right=%tree` (or any script by its name) and the door arranges his tiles.
  const agent: Actor = { kind: "agent", id: "script-cli-test" };
  const tilesNow = async (app: typeof h.app) => ((await app.dispatch.act({ action: "layout.get" }, USER)) as ReturnType<Desk["layoutAll"]>).layers.find(l => !l.drawer)!.tiles;

  test("a script's name typed as an action runs it with a button's slots, and left= right= take pages and tiles", async () => {
    const { app, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "neat" } }, USER);
    const listed = await h.board.listExtensions(true);
    expect(listed.extensions.some(e => e.name === "neat" && e.script)).toBe(true);
    await app.loadExtensions(true);
    // A terminal the person keeps, and a tile to send to the far right.
    await app.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" } }, USER);
    await app.dispatch.act({ action: "tile.open", args: { kind: "tree", name: "plot" } }, USER);
    const exhibit = (await tilesNow(app)).find(t => t.name === "plot")!;
    const before = (await tilesNow(app)).find(t => t.name === "kettle")!;
    // `act neat …` is the same run as `act script.run of=neat …`: two pages, one tile by the name layout.get shows.
    const r = await app.act({ action: "neat", args: { page: [`((${seeded.notes.shed.id}))`], right: `%${exhibit.name}` }, as: agent.id }) as { message?: string };
    expect(JSON.stringify(r)).toContain("neat:");
    const tiles = await tilesNow(app);
    const shed = tiles.find(t => t.showing?.id === seeded.notes.shed.id)!;
    const far = tiles.find(t => t.tile === exhibit.tile)!;
    expect(shed.collapsed).not.toBe(true);
    expect(far.collapsed).not.toBe(true);
    expect(shed.rect!.col).toBe(0);
    expect(far.rect!.col + far.rect!.cols).toBe(Math.max(...tiles.filter(t => !t.collapsed && t.shown !== false).map(t => t.rect!.col + t.rect!.cols)));
    // The terminal is left as it was: neither folded nor moved off its place.
    const kettle = tiles.find(t => t.name === "kettle")!;
    expect(kettle.collapsed).toBe(before.collapsed);
  }, 30_000);

  test("a script nobody has is refused with the nearest names and the call that works", async () => {
    const { app } = h;
    await app.loadExtensions(true);
    await expect(app.act({ action: "script.run", args: { of: "nea" }, as: agent.id })).rejects.toThrow(/no script called nea here; did you mean neat\?.*script\.run of=<name>/);
    await expect(app.act({ action: "neet", args: {}, as: agent.id })).rejects.toThrow(/nothing here answers to neet.*neat/);
    // A slot naming a page or a tile nobody has is said in the run's answer, never a quiet default.
    const said = JSON.stringify(await app.act({ action: "neat", args: { page: "[[no such page]]", right: "%no-such-tile" }, as: agent.id }));
    expect(said).toMatch(/2 steps failed.*no page no such page.*no tile no-such-tile/);
  });

  test("a tile named like a kind is that tile, and a group holding a terminal is left alone", async () => {
    const { app, seeded } = h;
    await app.dispatch.act({ action: "section", args: { name: "neat" } }, USER);
    await app.loadExtensions(true);
    await app.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "terminal" } }, USER);
    await app.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" } }, USER);
    await app.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "inner" } }, USER);
    await app.dispatch.act({ action: "tile.group", tile: "inner" }, USER);
    await app.dispatch.act({ action: "tile.collapse", args: { on: true }, tile: "kettle" }, USER);
    await app.act({ action: "neat", args: { page: `((${seeded.notes.shed.id}))`, right: "%terminal" }, as: agent.id });
    const tiles = await tilesNow(app);
    const named = tiles.find(t => t.name === "terminal")!, kettle = tiles.find(t => t.name === "kettle")!;
    // %terminal is the tile called terminal: the other terminal is not moved or unfolded.
    expect(named.collapsed).not.toBe(true);
    expect(kettle.collapsed).toBe(true);
    // The group with a terminal inside stays open.
    const group = tiles.find(t => (t as { mount?: unknown }).mount)!;
    expect(group).toBeDefined();
    expect(group.collapsed).not.toBe(true);
  }, 30_000);

  test("script.run finds the script a button there would: the note's own before the outline's", async () => {
    const { app, board } = h;
    await board.createBlock(null, "Global scoped [script::scoped]\n```js\nreturn 'global';\n```");
    // A script note answers for the notes under it (its ancestors' scripts come before the outline's).
    const home = await board.createBlock(null, "Local scoped [script::scoped]\n```js\nreturn 'local';\n```");
    const caller = await board.createBlock(home.id, "Caller note");
    await app.loadExtensions(true);
    const r = await app.act({ action: "script.run", args: { of: "scoped", block: caller.id }, as: agent.id }) as { message?: string };
    expect(r.message).toBe("local");
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
