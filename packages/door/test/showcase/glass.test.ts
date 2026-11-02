import { describe, expect, test } from "bun:test";
import { formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { SocketBoard } from "../../src/socket";
import { prop } from "../../src/props";
import { join, resolve } from "node:path";
import { startControl } from "../../src/control";
import { Desk } from "../../src/desk/desk";
import { ReaderPane } from "../../src/desk/panes";
import { PostIt } from "../../src/desk/post-it";
import { Shelf } from "../../src/desk/shelf";
import { Mirror } from "../../src/mirror";
import { SECTIONS } from "../../src/showcase/showcase";
import { traceActions } from "../../src/surface/actions";
import { visible } from "../../src/style";
import { KeyDecoder } from "../../src/term";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe("showcase: the glass", () => {
  const h = useShowcaseScreen(177);
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => h.app.dispatch.act({ action, args, tile }, { kind: "user" }) as Promise<any>;
  const stage = () => h.S().stage(SECTIONS.findIndex(s => s.key === "glass")).top as Desk;
  const floats = () => h.app.glass.floats();
  const post = () => floats().find(f => f.pane instanceof PostIt && f.pane.hover)!;
  const paper = () => { const p = post().pane; if (!(p instanceof PostIt)) throw new Error("hover is not a post-it"); return p; };
  const lines = () => h.painted.map(visible);
  const cell = (words: string) => { const y = lines().findIndex(l => l.includes(words)); expect(y, `${words}\n${lines().join("\n")}`).toBeGreaterThan(-1); return { x: lines()[y]!.indexOf(words), y }; };
  const input = (bytes: string) => {
    const decoder = new KeyDecoder(h.app.terminalSize);
    decoder.keyHandler = h.press;
    decoder.feed(bytes);
  };
  const sgr = (button: number, x: number, y: number, up = false) => input(`\x1b[<${button};${x + 1};${y + 1}${up ? "m" : "M"}`);
  const hover = (p: { x: number; y: number }, alt = false) => sgr(35 + (alt ? 8 : 0), p.x, p.y);
  const click = (p: { x: number; y: number }, alt = false) => { sgr(alt ? 8 : 0, p.x, p.y); sgr(alt ? 8 : 0, p.x, p.y, true); };
  const setup = async (cols = 177) => {
    await act("glass.clear"); await act("glass.mode", { set: "off" });
    await act("host.toggle", { open: false });
    h.app.terminalSize.cols = cols;
    await act("section.try", { name: "glass" });
    for (const [name, value] of Object.entries({ open: 80, close: 160, grace: 120, stack: 3 })) await act("glass.tune", { name, value });
    await act("tile.focus", {}, "links");
    hover({ x: 0, y: 0 }); h.app.flush();
    await until(() => lines().some(l => l.includes("tool shed")), "the glass demo's links");
  };
  const agent = async (action: string, args: string[]) => {
    const control = await startControl({ app: h.app, mirror: new Mirror(177, 60), info: () => h.app.t }, join(h.scratch.root, "glass.sock"));
    try {
      const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, "../../src/main.ts"), "act", action, ...args, "--as", "gardener"], {
        env: { ...process.env, ...h.scratch.env, EP0CH_CONTROL: control.path, EP0CH_STATE: join(h.scratch.root, "door"), EP0CH_SOCKET: h.scratch.sock }, stdout: "pipe", stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text(), err = await new Response(proc.stderr).text();
      expect(await proc.exited, out + err).toBe(0);
      return out;
    } finally { control.close(); }
  };

  test("peel keeps the hover stack; drop removes only its shown stop and forward shares the reader's history", async () => {
    await setup();
    await act("glass.mode", { set: "sticky" });
    hover(cell("tool shed")); await until(() => !!post(), "the first hover");
    hover(cell("garden notebook"));
    await until(() => paper().msg?.id === h.seeded.notes.notebook.id, "the second hover");
    const source = post().tile, trail = paper().surface.trailOf();
    const peeled = await act("postit.peel", {}, source);
    expect(floats().find(f => f.tile === peeled.tile)?.pane).toBeInstanceOf(PostIt);
    expect(paper().surface.trailOf()).toEqual(trail);
    await act("back", {}, source);
    expect(paper().msg?.id).toBe(h.seeded.notes.shed.id);
    await act("forward", {}, source);
    expect(paper().msg?.id).toBe(h.seeded.notes.notebook.id);
    await act("postit.drop", {}, source);
    expect(paper().msg?.id).toBe(h.seeded.notes.shed.id);
    expect(paper().surface.trailOf().forward).toEqual([]);
    expect((floats().find(f => f.tile === peeled.tile)!.pane as PostIt).msg?.id).toBe(h.seeded.notes.notebook.id);
  }, 20_000);

  test("a named coloured shelf takes refs, draws list and grid, and restores them with the host layout", async () => {
    await setup();
    await act("button.press", { label: "Three refs on a shelf" }, "links");
    await until(() => floats().some(f => f.pane instanceof Shelf && f.pane.refs.length === 3), "the kitchen-sink button's shelf");
    const shelf = floats().find(f => f.pane instanceof Shelf)!;
    h.app.flush();
    expect(lines().join("\n")).toContain("amber");
    expect(lines().join("\n")).toContain("seeds");
    const rows = await act("list.blocks", {}, shelf.tile);
    expect(JSON.stringify(rows)).toContain(h.seeded.notes.shed.id);
    await act("shelf.layout", { set: "grid" }, shelf.tile);
    const host = h.app.drawer.made!;
    const saved = JSON.parse(JSON.stringify(host.savedState()));
    const restored = new Desk(host.spec, { saved, writes: false });
    restored.enter(h.app);
    try {
      await until(() => JSON.stringify(restored.layoutGet()).includes(h.seeded.notes.notebook.id), "the restored shelf refs");
      expect(JSON.stringify(restored.layoutGet())).toContain("grid");
      expect(JSON.stringify(restored.layoutGet())).toContain("amber");
    } finally { restored.dispose(); }
  }, 20_000);

  test("a glass float docks on the work area and tucks into the drawer without a second tile", async () => {
    await setup();
    await act("screen.save", { name: "glass-before-dock" });
    await act("glass.mode", { set: "sticky" });
    hover(cell("tool shed")); await until(() => !!post(), "the hover to dock");
    const pin = post();
    const pane = floats().find(f => f.tile === pin.tile)!.pane;
    const docked = await act("tile.dock", { on: true, edge: "left" }, pin.tile);
    expect(stage().layoutGet().tiles.some(t => t.tile === docked.tile)).toBe(true);
    expect(stage().pane(docked.tile)).toBe(pane);
    expect(floats().some(f => f.pane === pane)).toBe(false);
    const tucked = await act("tile.drawer", { on: true }, docked.tile);
    expect(h.app.drawer.made!.pane(tucked.tile)).toBe(pane);
    h.app.flush();
    const r = h.app.drawer.made!.tileInfo(tucked.tile).rect!;
    click({ x: r.col + 3, y: r.row + 3 });
    input("\x1bE");
    await until(() => floats().some(f => f.tile === tucked.tile), "the peel key returns the drawer's post-it");
    const peeled = tucked;
    expect(floats().find(f => f.tile === peeled.tile)?.pane).toBe(pane);
    await act("float.place", { col: 2, row: 30, cols: 56, rows: 20 }, peeled.tile); h.app.flush();
    hover(cell("garden notebook"));
    await until(() => !!post() && post().pane !== pane, "a new hover leaves the drawer's peeled pin alone");
    expect((pane as PostIt).msg?.id).toBe(h.seeded.notes.shed.id);
    await act("tile.drawer", {}, peeled.tile);
    expect(floats().some(f => f.pane === pane)).toBe(false);
    expect(h.app.drawer.tabs().some(t => h.app.drawer.made!.pane(t.name) === pane)).toBe(true);
    expect(h.app.drawer.made!.floatingTiles().some(f => f.pane === pane)).toBe(false);
    await act("tile.close", {}, peeled.tile);
    await act("layout.load", { name: "glass-before-dock" });
  }, 20_000);

  test("a shelf follows a burst of title changes without rereading for every write", async () => {
    await setup();
    const writer = new SocketBoard(h.scratch.sock);
    let note = await writer.createBlock(h.seeded.notes.root.id, "Seed tray 0");
    const shelf = await act("glass.shelf", { name: "seed trays", colour: "amber" });
    await act("glass.shelve", { ref: note.id, shelf: shelf.tile });
    h.app.flush();
    const get = h.board.get.bind(h.board);
    let reads = 0;
    h.board.get = async (...args) => { if (args[0] === note.id) reads++; return get(...args); };
    try {
      for (let n = 1; n <= 20; n++) note = await writer.update(note.id, `Seed tray ${n}`, note.revision!);
      await until(() => lines().some(l => l.includes("Seed tray 20")), "the shelf's latest title");
      console.info("shelf refresh:", { writes: 20, reads });
      expect(reads, "a burst gets one refresh, plus a change arriving during its read").toBeLessThanOrEqual(2);
    } finally { h.board.get = get; writer.close(); }
  }, 20_000);

  test.each([177, 80])("a post-it dragged off the glass lands in the work area's layout at %i columns", async cols => {
    await setup(cols);
    await act("screen.save", { name: "glass-before-drag" });
    const pin = await act("glass.pin", { ref: h.seeded.notes.shed.id });
    const pane = floats().find(f => f.tile === pin.tile)!.pane;
    await act("float.place", { col: 2, row: 30, cols: 56, rows: 20 }, pin.tile); h.app.flush();
    const d = stage(), r = d.layoutGet().tiles.find(t => t.name === "title")!.rect!;
    const x = d.screenOrigin.col + r.col + 24, y = d.screenOrigin.row + r.row;
    sgr(0, 24, 30); sgr(32, x, y); sgr(0, x, y, true);
    await until(() => !floats().some(f => f.pane === pane), "the float lands on the work area");
    const landed = d.layoutGet().tiles.find(t => d.pane(t.tile) === pane);
    expect(d.floatingTiles().some(f => f.pane === pane)).toBe(false);
    expect(landed).toBeDefined();
    await act("tile.close", {}, landed!.tile);
    await act("layout.load", { name: "glass-before-drag" });
  }, 20_000);

  test("dragging a post-it onto a shelf uses its drop zone and removes the loose post-it", async () => {
    await setup();
    const shelf = await act("glass.shelf", { name: "cuttings", colour: "green" });
    await act("float.place", { col: 82, row: 4, cols: 76, rows: 24 }, shelf.tile);
    const ran: string[] = [], stop = traceActions(r => ran.push(r.name));
    try {
      for (const note of [h.seeded.notes.shed, h.seeded.notes.notebook]) {
        const pin = await act("glass.pin", { ref: note.id });
        await act("float.place", { col: 2, row: 30, cols: 56, rows: 20 }, pin.tile); h.app.flush();
        sgr(0, 24, 30); sgr(32, 104, 12); h.app.flush();
        expect(lines().join("\n")).toContain("shelve on cuttings");
        sgr(0, 104, 12, true);
        await until(() => !floats().some(f => f.tile === pin.tile), "the post-it lands on the shelf");
        expect(JSON.stringify(await act("list.blocks", {}, shelf.tile))).toContain(note.id);
      }
      expect(ran).toContain("postit.shelve");
    } finally { stop(); }
  }, 20_000);

  test.each([177, 80])("peel and drop by key and header, then select and open a shelf in list and grid at %i columns", async cols => {
    await setup(cols);
    await act("glass.mode", { set: "sticky" });
    hover(cell("tool shed")); await until(() => !!post(), "the hover stack");
    const original = post();
    await act("float.place", { col: 1, row: 24, cols: 76, rows: 26 }, original.tile); h.app.flush();
    click({ x: 4, y: 27 });
    const ran: string[] = [], stop = traceActions(r => ran.push(r.name));
    try {
      input("\x1bE");
      await until(() => floats().length === 2, "the peel key keeps the hover stack");
      const pin = floats().find(f => f.pane !== original.pane)!;
      await act("tile.close", {}, pin.tile); h.app.flush();
      click({ x: lines()[24]!.indexOf("peel", 1), y: 24 }); await until(() => floats().length === 2, "the peel header");
      const copy = floats().find(f => f.pane !== original.pane)!;
      await act("float.place", { col: 1, row: 2, cols: 76, rows: 20 }, copy.tile); h.app.flush();
      click({ x: 4, y: 5 }); input("\x1bX");
      await until(() => floats().length === 1, "the drop key closes the last entry");
      const stops = () => { const trail = (original.pane as PostIt).surface.trailOf(); return trail.back.length + trail.forward.length + ((original.pane as PostIt).msg ? 1 : 0); };
      const before = stops();
      h.app.flush(); click({ x: lines()[24]!.indexOf("drop", 1), y: 24 }); await until(() => stops() === before - 1, "the drop header removes one entry");
      await act("glass.clear");
      await act("glass.mode", { set: "off" });
      const shelf = await act("glass.shelf", { name: "seed-shelf", colour: "amber" });
      await act("float.place", { col: 1, row: 2, cols: cols === 177 ? 156 : 76, rows: 22 }, shelf.tile);
      for (const note of [h.seeded.notes.shed, h.seeded.notes.notebook, h.seeded.notes.glassTitle]) await act("glass.shelve", { ref: note.id, shelf: shelf.tile });
      const p = floats().find(f => f.tile === shelf.tile)!.pane as Shelf;
      for (const layout of ["list", "grid"] as const) {
        await act("shelf.layout", { set: layout }, shelf.tile); h.app.flush();
        const point = cell("Bike shed"); click(point);
        await until(() => floats().some(f => f.pane instanceof ReaderPane && f.pane.msg?.id === h.seeded.notes.shed.id), "one click selects and previews");
        expect(p.selected()?.id).toBe(h.seeded.notes.shed.id);
        expect(h.app.person().address).toBe(shelf.tile);
        const preview = floats().find(f => f.pane instanceof ReaderPane && f.pane.msg?.id === h.seeded.notes.shed.id)!;
        expect(preview, "a shelf row has a preview").toBeDefined();
        h.app.flush(); click(point);
        await until(() => h.app.person().address === preview.tile, "the second click opens the same preview");
        await act("tile.close", {}, preview.tile);
      }
      h.app.flush(); click({ x: 5, y: 20 }); h.ch("v");
      await until(() => p.layout === "list", "the shelf layout key");
      h.app.flush(); click(cell("grid")); await until(() => p.layout === "grid", "the grid header");
      h.app.flush();
      h.press({ kind: "right" });
      await until(() => p.selected()?.id === h.seeded.notes.notebook.id, "the shared list key crosses grid columns");
      h.ch("c"); await until(() => p.colour !== "amber", "the colour key");
      const colour = p.colour; h.app.flush(); click(cell(colour));
      await until(() => p.colour !== colour, "the colour header");
      expect(ran).toEqual(expect.arrayContaining(["postit.peel", "postit.drop", "shelf.layout", "shelf.colour", "list.pick", "list.open"]));
    } finally { stop(); }
  }, 30_000);

  test("an agent pins onto a shelf without changing the person's post-it or selection, and clear keeps an entered shelf", async () => {
    await setup();
    const shelf = await act("glass.shelf", { name: "garden-shelf", colour: "violet" });
    await act("float.place", { col: 82, row: 2, cols: 76, rows: 24 }, shelf.tile);
    await act("glass.shelve", { ref: h.seeded.notes.shed.id, shelf: shelf.tile });
    const pin = await act("glass.pin", { ref: h.seeded.notes.notebook.id });
    await act("float.place", { col: 1, row: 28, cols: 76, rows: 24 }, pin.tile); h.app.flush();
    click({ x: 4, y: 31 });
    const before = floats().find(f => f.tile === pin.tile)!, p = floats().find(f => f.tile === shelf.tile)!.pane as Shelf;
    const selected = p.list.pickedId();
    const said = await agent("glass.pin", [`ref=${h.seeded.notes.glassTitle.id}`, `shelf=${shelf.tile}`]);
    expect(said).toContain("garden-shelf");
    expect(h.app.person().address).toBe(pin.tile);
    expect(floats().find(f => f.tile === pin.tile)?.rect).toEqual(before.rect);
    expect(p.list.pickedId()).toBe(selected);
    expect(p.refs.find(r => r.ref === h.seeded.notes.glassTitle.id)?.by).toBe("gardener");
    expect(h.app.glass.describe().pinned).toBe(2);
    h.app.flush(); expect(lines().join("\n")).toContain("gardener");
    click({ x: 85, y: 22 });
    await agent("glass.clear", []);
    expect(floats().map(f => f.tile)).toEqual([shelf.tile]);
    expect(h.app.person().address).toBe(shelf.tile);
  }, 20_000);

  test("a post-it keeps its stack and the person's keys while travelling across screens", async () => {
    await setup();
    const before = h.app.person().focus;
    await act("glass.mode", { set: "on" });
    await act("glass.pin", { ref: h.seeded.notes.shed.id });
    await until(() => lines().some(l => l.includes("post-it 1/1")), "the glass post-it");
    expect(h.app.person().focus).toBe(before);
    await act("section.try", { name: "panes" });
    await until(() => lines().some(l => l.includes("post-it 1/1")), "the same post-it above another screen");
    await act("glass.clear");
    await until(() => !lines().some(l => l.includes("post-it 1/1")), "clear the glass");
  }, 20_000);

  test.each([177, 80])("SGR hover at %i columns stays put, accepts entry, flips by keys and title wheel, then returns keys", async cols => {
    await setup(cols);
    const bar = await act("status.bar.items"), glyph = bar.items.find((i: any) => i.id === "glass");
    expect(glyph.from).toBeDefined();
    click({ x: glyph.from, y: h.app.terminalSize.rows - 1 });
    await until(() => h.app.glass.mode === "on", "click turns hover on");
    const ran: string[] = [], untrace = traceActions(r => ran.push(r.name));
    const origin = cell("tool shed"), focus = stage().focusName(), drawer = h.app.drawer.open;
    hover(origin);
    expect(floats()).toHaveLength(0);
    await until(() => !!post(), "hover opens after its delay");
    expect(paper().msg?.id).toBe(h.seeded.notes.shed.id);
    expect(stage().focusName()).toBe(focus);
    expect(h.app.drawer.entered).toBe(false);
    const rect = { ...post().rect };
    expect(rect.col + rect.cols / 2 < cols / 2).toBe(origin.x >= cols / 2);
    const tile = post().tile, get = h.board.get;
    // Hold the real host's answer past the close delay: the hovered link is still under the pointer.
    if (cols === 80) h.board.get = async id => { const m = await get.call(h.board, id); if (id === h.seeded.notes.notebook.id) await Bun.sleep(240); return m; };
    try {
      hover(cell("garden notebook"));
      await until(() => !!post() && paper().msg?.id === h.seeded.notes.notebook.id, "a second hover in the same post-it");
      expect(post().tile).toBe(tile);
    } finally { h.board.get = get; }
    expect(post().rect).toEqual(rect);
    expect(floats()).toHaveLength(1);
    await act("glass.tune", { name: "grace", value: 400 });
    hover({ x: Math.round((origin.x + rect.col + rect.cols / 2) / 2), y: Math.round((origin.y + rect.row) / 2) });
    await Bun.sleep(250);
    expect(floats()).toHaveLength(1);
    hover({ x: rect.col + 2, y: rect.row + 2 });
    await Bun.sleep(350);
    expect(floats()).toHaveLength(1);
    click({ x: rect.col + 2, y: rect.row + 2 });
    expect(h.app.drawer.entered).toBe(true);
    expect(h.app.drawer.open).toBe(drawer);
    h.press({ kind: "left" });
    await until(() => paper().msg?.id === h.seeded.notes.shed.id, "left flips back");
    expect(paper().title()).toMatch(/post-it \d\/\d/);
    sgr(65, rect.col + 8, rect.row);
    await until(() => paper().msg?.id === h.seeded.notes.notebook.id, "title wheel flips forward");
    h.ch("p"); await until(() => paper().sticky, "the sticky key");
    h.app.flush(); click(cell("◆"));
    await until(() => !paper().sticky, "the sticky header control");
    h.press({ kind: "esc" });
    await until(() => !post(), "Esc dismisses the post-it");
    expect(h.app.drawer.entered).toBe(false);
    expect(stage().focusName()).toBe(focus);
    untrace(); expect(ran).toContain("postit.flip"); expect(ran).toContain("postit.stick"); expect(ran).toContain("glass.dismiss");
  }, 20_000);

  test("alt-hover works while off; sizes, the bounded history and sticky dismissal survive new targets", async () => {
    await setup();
    hover(cell("tool shed"), true);
    await until(() => !!post(), "alt-hover while off");
    expect(paper().sticky).toBe(true);
    await act("float.place", { cols: 48, rows: 14 }, post().tile);
    h.app.flush();
    hover({ x: 0, y: 0 }); await Bun.sleep(400);
    expect(post().rect.cols).toBe(48);
    await act("glass.dismiss");
    hover(cell("garden notebook"), true);
    await until(() => !!post(), "the next sticky hover");
    expect(post().rect.cols).toBe(48);
    expect(post().rect.rows).toBe(14);
    for (const words of ["tool shed", "garden gallery", "garden notebook", "tool shed"]) {
      hover(cell(words), true); await Bun.sleep(160);
    }
    expect(paper().title()).toBe("post-it 3/3");
    hover(cell("tool shed"), true); await Bun.sleep(160);
    expect(paper().title()).toBe("post-it 3/3");
    h.press({ kind: "alt", ch: "U" });
    await until(() => !floats().length, "the clear key");
    await act("glass.mode", { set: "on" });
    hover(cell("tool shed")); await until(() => !!post(), "an ordinary hover");
    hover({ x: 0, y: 0 });
    await until(() => !post(), "leaving closes after the close delay");
    h.press({ kind: "alt", ch: "u" });
    await until(() => h.app.glass.mode === "sticky", "the mode key cycles on to sticky");
    hover(cell("tool shed")); await until(() => !!post(), "sticky mode opens");
    hover({ x: 0, y: 0 }); await Bun.sleep(350);
    expect(paper().sticky).toBe(true);
    const bar = await act("status.bar.items"), glyph = bar.items.find((i: any) => i.id === "glass");
    click({ x: glyph.from, y: 59 });
    await until(() => h.app.glass.mode === "off" && !post(), "the glyph cycles sticky to off and dismisses");
  }, 20_000);

  test("cut-off text and links inside a pinned post-it use the same reader and bounded stack", async () => {
    await setup();
    h.press({ kind: "alt", ch: "u" });
    await until(() => h.app.glass.mode === "on", "the hover key");
    hover(cell("The spring planting"));
    await until(() => !!post(), "the cut-off title's post-it");
    expect(paper().msg?.text).toContain("before the afternoon rain arrives");
    await act("glass.clear");
    await act("glass.pin", { ref: h.seeded.notes.glass.id }); h.app.flush();
    const pin = floats()[0]!;
    await act("float.place", { col: 1, row: 25, cols: 72, rows: 26 }, pin.tile); h.app.flush();
    const rendered = lines(), y = rendered.findIndex((l, row) => row > 25 && l.includes("tool shed"));
    expect(y).toBeGreaterThan(25);
    hover({ x: rendered[y]!.indexOf("tool shed") + 1, y });
    await until(() => pin.pane instanceof PostIt && pin.pane.msg?.id === h.seeded.notes.shed.id, "the link extends this pin's own stack");
    expect(floats()).toHaveLength(1);
    expect(pin.pane instanceof PostIt && pin.pane.title()).toBe("post-it 2/2");
    await act("glass.tune", { name: "limit", value: 1 });
    await act("glass.pin", { ref: "Remember the seed trays" }); h.app.flush();
    expect(h.app.glass.chip()).toContain("2!");
    const bar = await act("status.bar.items"), glyph = bar.items.find((i: any) => i.id === "glass");
    click({ x: glyph.from, y: 59 }, true);
    await until(() => !floats().length, "alt-click clears the counted pins");
  }, 20_000);

  test("a hover wire is saved with the screen and receives the hover without a glass post-it", async () => {
    await setup();
    await act("tile.link", { verb: "hover", to: "title" }, "links");
    const saved = JSON.parse(JSON.stringify(stage().savedState()));
    const restored = new Desk(stage().spec, { saved, writes: false });
    restored.enter(h.app);
    try {
      expect(restored.layoutGet().tiles.find(t => t.name === "links")?.wires?.some(w => w.verb === "hover")).toBe(true);
    } finally { restored.dispose(); }
    await act("glass.mode", { set: "on" });
    hover(cell("tool shed"));
    await until(() => { const p = stage().pane("title"); return p instanceof ReaderPane && p.msg?.id === h.seeded.notes.shed.id; }, "the hover wire's destination reads the note");
    expect(floats()).toHaveLength(0);
    expect(stage().focusName()).toBe("links");
    await act("tile.link", { verb: "hover" }, "links");
    await act("open", { id: h.seeded.notes.glassTitle.id }, "title");
    await act("tile.link", { verb: "hover", to: "links" }, "title");
    h.app.flush(); hover(cell("The spring planting"));
    await until(() => { const p = stage().pane("links"); return p instanceof ReaderPane && !!p.msg?.text.includes("before the afternoon rain arrives"); }, "a cut-off title follows its tile's hover wire");
    expect(floats()).toHaveLength(0);
    await act("tile.link", { verb: "hover" }, "title");
    await act("open", { id: h.seeded.notes.glass.id }, "links");
  }, 20_000);

  test("closing a hover preserves the keys in another post-it", async () => {
    await setup();
    await act("glass.mode", { set: "on" }); hover(cell("tool shed"));
    await until(() => !!post(), "hover before the pin");
    await agent("glass.pin", ["ref=Keep the watering can here"]);
    const pin = floats().find(f => f.pane instanceof PostIt && !f.pane.hover)!;
    await act("float.place", { col: 2, row: 24, cols: 50, rows: 18 }, pin.tile); h.app.flush();
    click({ x: 4, y: 27 });
    const focus = h.app.person().focus;
    await agent("glass.dismiss", []);
    expect(floats().map(f => f.tile)).toEqual([pin.tile]);
    expect(h.app.person().focus).toBe(focus);
    expect(h.app.drawer.glassHasKeys(pin.tile)).toBe(true);
  });

  test("glass readers keep the host's power bar, drawer keys and leave chord", async () => {
    await setup(); await act("glass.pin", { ref: h.seeded.notes.shed.id }); h.app.flush();
    const pin = floats()[0]!;
    await act("tile.zoom", { reach: "full", on: true }, "links"); h.app.flush();
    click({ x: pin.rect.col + 3, y: pin.rect.row + 3 });
    try {
      h.press({ kind: "char", ctrl: true, ch: "k" });
      await until(() => !!h.app.bar, "the power bar from glass", 2000);
    } finally { if (h.app.bar) h.press({ kind: "esc" }); await stage().dispatch.press("tile.zoom", { on: false }, "links"); }
    const open = h.app.drawer.open;
    h.press({ kind: "alt", ch: "a" });
    await until(() => h.app.drawer.open !== open, "the host drawer key from glass", 2000);
    await act("host.toggle", { open: false });
    await act("glass.clear");
    await act("tile.float", { to: "glass" }, "title"); h.app.flush();
    const reader = floats()[0]!;
    click({ x: reader.rect.col + 3, y: reader.rect.row + 3 });
    h.press({ kind: "char", ctrl: true, ch: "]" });
    expect(h.app.drawer.entered).toBe(false);
    expect(floats()[0]?.tile).toBe(reader.tile);
    await act("tile.drawer", { on: false }, reader.tile);
  });

  test("a selection released outside a post-it still copies its text", async () => {
    await setup(); await act("glass.pin", { ref: "Selection sample\nCarry the watering can to the gate." });
    const pin = floats()[0]!;
    await act("float.place", { col: 30, row: 20, cols: 60, rows: 20 }, pin.tile); h.app.flush();
    const start = cell("Carry the watering"), before = h.written.length;
    sgr(0, start.x, start.y); sgr(32, start.x + 5, start.y);
    sgr(32, 100, start.y); sgr(0, 100, start.y, true);
    const copies = h.written.slice(before).join("").match(/\x1b\]52;c;([A-Za-z0-9+/=]+)/);
    expect(Buffer.from(copies?.[1] ?? "", "base64").toString()).toContain("Carry the watering can to the gate.");
  });

  test.each([1, 3])("clicking a post-it link records one stop within a stack of %i", async limit => {
    await setup(); await act("glass.tune", { name: "stack", value: limit });
    await act("glass.pin", { ref: h.seeded.notes.glass.id });
    const pin = floats()[0]!;
    await act("float.place", { col: 2, row: 25, cols: 74, rows: 26 }, pin.tile); h.app.flush();
    const y = lines().findIndex((l, row) => row > 25 && l.includes("tool shed"));
    click({ x: lines()[y]!.indexOf("tool shed") + 1, y });
    await until(() => pin.pane instanceof PostIt && pin.pane.msg?.id === h.seeded.notes.shed.id, "the clicked link", 2000);
    expect(pin.pane.title()).toBe(limit === 1 ? "post-it 1/1" : "post-it 2/2");
  });

  test("screen menus paint and receive clicks above a glass tile", async () => {
    await setup(); await act("glass.pin", { ref: "A reminder across the menu" });
    const pin = floats()[0]!, d = stage();
    await act("float.place", { col: 65, row: 15, cols: 80, rows: 30 }, pin.tile);
    await d.dispatch.press("tile.menu", { at: `${67 - d.screenOrigin.col},${17 - d.screenOrigin.row}`, q: "zoom" }, "links"); h.app.flush();
    try {
      const y = lines().findIndex(l => /zoom\s+\^W z/.test(l));
      expect(y, "the menu row above glass").toBeGreaterThan(-1);
      click({ x: lines()[y]!.search(/zoom\s+\^W z/), y });
      await until(() => d.layoutGet().zoom === "links", "the menu click zooms its screen tile", 2000);
    } finally {
      if (d.overlaid()) { h.press({ kind: "esc" }); h.press({ kind: "esc" }); }
      if (d.layoutGet().zoom !== null) await d.dispatch.press("tile.zoom", { on: false }, "links");
    }
  });

  test("moving between identical references keeps the hover open", async () => {
    await setup();
    const note = await h.board.createBlock(null, `Two paths\n((${h.seeded.notes.shed.id}|same path))\n\n((${h.seeded.notes.shed.id}|same path))`);
    await act("open", { id: note.id }, "links");
    try {
      await act("glass.mode", { set: "on" }); h.app.flush();
      const rows = lines().flatMap((line, y) => line.includes("same path") ? [{ x: line.indexOf("same path"), y }] : []);
      expect(rows).toHaveLength(2);
      hover(rows[0]!); await until(() => !!post(), "the first reference");
      const tile = post().tile;
      hover(rows[1]!); await Bun.sleep(350);
      expect(post()?.tile).toBe(tile);
    } finally { await act("open", { id: h.seeded.notes.glass.id }, "links"); }
  });

  test.each(["hover", "restore"])("foreign post-its retain their outline through %s", async way => {
    await setup();
    const foreign = new SocketBoard(h.scratch.sock, undefined, "showcase-orchard");
    try {
      const info = await foreign.info(), id = prop(h.seeded.notes.crossOutline, "foreign-note")!;
      const uri = formatEp0chBlockUri({ outline: "showcase-orchard", machine: info.machine!, blockId: id });
      await act("glass.pin", { ref: uri });
      const pin = floats()[0]!;
      if (way === "hover") {
        await act("float.place", { col: 2, row: 25, cols: 80, rows: 24 }, pin.tile);
        await act("glass.mode", { set: "on" }); h.app.flush();
        const y = lines().findIndex((l, row) => row > 25 && l.includes("pear-tree"));
        hover({ x: lines()[y]!.indexOf("pear-tree") + 1, y });
        await until(() => pin.pane instanceof PostIt && !!pin.pane.msg?.text.includes("Water deeply"), "the local link in the foreign outline", 2000);
        expect(pin.pane instanceof PostIt && pin.pane.msg?.address?.outline).toBe("showcase-orchard");
      } else {
        await act("link.follow", { n: 1 }, pin.tile);
        await act("postit.flip", { by: -1 }, pin.tile);
        const d = h.app.drawer.made!, saved = JSON.parse(JSON.stringify(d.savedState()));
        const restored = new Desk(d.spec, { saved, writes: false }); restored.enter(h.app);
        try {
          await until(() => restored.floatingTiles().some(f => f.pane instanceof PostIt && f.pane.msg?.id === id), "the restored foreign post-it", 2000);
          const p = restored.floatingTiles()[0]!.pane;
          expect(p instanceof PostIt && p.msg?.address?.outline).toBe("showcase-orchard");
          expect(p.title()).toBe("post-it 1/2");
          await restored.dispatch.press("postit.flip", { by: 1 }, restored.floatingTiles()[0]!.tile);
          expect(p instanceof PostIt && p.msg?.text).toContain("Water deeply");
        } finally { restored.dispose(); }
      }
    } finally { foreign.close(); }
  });

  test("an agent's pin and clear preserve the post-it the person entered, and host floats remain over groups and the drawer", async () => {
    await setup();
    await act("host.toggle", { open: true });
    await act("host.toggle", { open: false });
    await agent("glass.pin", [`ref=${h.seeded.notes.glass.id}`]);
    await until(() => floats().length === 1, "the agent's attributed pin");
    const first = floats()[0]!;
    expect(first.pane instanceof PostIt && first.pane.by).toBe("gardener");
    expect(h.app.drawer.entered).toBe(false);
    click({ x: first.rect.col + 2, y: first.rect.row + 2 });
    await agent("glass.pin", ["ref=A reminder to water the seedlings"]);
    expect(h.app.person().address).toBe(first.tile);
    expect(floats()).toHaveLength(2);
    expect(floats().find(f => f.tile === first.tile)?.rect).toEqual(first.rect);
    await agent("glass.clear", []);
    expect(floats().map(f => f.tile)).toEqual([first.tile]);
    await act("glass.clear");
    await act("tile.group", { with: "title", name: "garden-group" }, "links");
    await act("glass.pin", { ref: h.seeded.notes.shed.id });
    await act("host.toggle", { open: true }); h.app.flush();
    expect(lines().join("\n")).toContain("post-it 1/1");
    await act("host.toggle", { open: false });
    await act("glass.clear");
    await act("tile.group", {}, "garden-group");
    await act("tile.float", { to: "glass" }, "title");
    const reader = floats()[0]!;
    await act("section.try", { name: "screen" }); h.app.flush();
    expect(floats()[0]?.tile).toBe(reader.tile);
    await act("float.place", { col: 2, row: 2, cols: 52, rows: 15 }, reader.tile);
    expect(floats()[0]?.rect).toEqual({ col: 2, row: 2, cols: 52, rows: 15 });
    await act("tile.drawer", { on: true }, reader.tile);
    expect(floats()).toHaveLength(0);
    await act("tile.float", { to: "glass" }, reader.tile);
    expect(floats()[0]?.tile).toBe(reader.tile);
    await act("glass.clear");
  }, 30_000);

  test("Tune's Glass tab changes the same saved delays by key, click and act", async () => {
    await act("host.toggle", { open: false });
    await act("section.try", { name: "glass" });
    const tune = await act("tile.tune", {}, "links");
    await act("tile.focus", {}, tune.tile);
    h.ch("G");
    await until(() => lines().some(l => l.includes("open delay (ms):")), "the Glass settings tab");
    const before = h.app.glass.settings.open;
    h.ch("+");
    await until(() => h.app.glass.settings.open === before + 50, "the Tune key changes the delay");
    h.app.flush(); click(cell("[−]"));
    await until(() => h.app.glass.settings.open === before, "the Tune minus button");
    await act("glass.tune", { name: "open", value: 125 }); h.app.flush();
    expect(lines().some(l => l.includes("open delay (ms): 125"))).toBe(true);
    await act("tile.close", {}, tune.tile);
  }, 15_000);

  test("a burst of SGR motion coalesces before hover resolution", async () => {
    await act("section.try", { name: "glass" });
    await act("glass.mode", { set: "on" });
    const before = h.app.speed.describe();
    for (let i = 0; i < 2000; i++) hover({ x: i % 12, y: 0 });
    await Bun.sleep(160);
    const after = h.app.speed.describe();
    const measured = { reports: after.reports - before.reports, coalesced: after.motionCoalesced - before.motionCoalesced, frames: after.frames - before.frames, settle: after.settle };
    console.log("glass motion:", JSON.stringify(measured));
    expect(measured.reports).toBe(2000);
    expect(measured.coalesced).toBeGreaterThan(1900);
    expect(measured.frames).toBeLessThan(20);
    expect(floats()).toHaveLength(0);
  });
});
