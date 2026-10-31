import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { startControl } from "../../src/control";
import { Desk } from "../../src/desk/desk";
import { ReaderPane } from "../../src/desk/panes";
import { PostIt } from "../../src/desk/post-it";
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
  const cell = (words: string) => { const y = lines().findIndex(l => l.includes(words)); expect(y, words).toBeGreaterThan(-1); return { x: lines()[y]!.indexOf(words), y }; };
  const sgr = (button: number, x: number, y: number, up = false) => {
    const decoder = new KeyDecoder(h.app.terminalSize);
    decoder.keyHandler = h.press;
    decoder.feed(`\x1b[<${button};${x + 1};${y + 1}${up ? "m" : "M"}`);
  };
  const hover = (p: { x: number; y: number }, alt = false) => sgr(35 + (alt ? 8 : 0), p.x, p.y);
  const click = (p: { x: number; y: number }, alt = false) => { sgr(alt ? 8 : 0, p.x, p.y); sgr(alt ? 8 : 0, p.x, p.y, true); };
  const setup = async (cols = 177) => {
    await act("glass.clear"); await act("glass.mode", { set: "off" });
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
    hover(cell("garden notebook"));
    await until(() => paper().msg?.id === h.seeded.notes.notebook.id, "a second hover in the same post-it");
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

  test("an agent's pin and clear preserve the post-it the person entered, and host floats remain over groups and the drawer", async () => {
    await setup();
    await agent("glass.pin", [`ref=${h.seeded.notes.glass.id}`]);
    await until(() => floats().length === 1, "the agent's attributed pin");
    const first = floats()[0]!;
    expect(first.pane instanceof PostIt && first.pane.by).toBe("gardener");
    expect(h.app.drawer.entered).toBe(false);
    click({ x: first.rect.col + 2, y: first.rect.row + 2 });
    await agent("glass.pin", ["ref=A reminder to water the seedlings"]);
    expect(floats()).toHaveLength(2);
    expect(floats().find(f => f.tile === first.tile)?.rect).toEqual(first.rect);
    await agent("glass.clear", []);
    expect(floats().map(f => f.tile)).toEqual([first.tile]);
    await act("glass.clear");
    await act("tile.group", { with: "title", name: "garden-group" }, "links");
    await act("glass.pin", { ref: h.seeded.notes.shed.id });
    await act("host.toggle", { open: true }); h.app.flush();
    expect(lines().some(l => l.includes("post-it 1/1"))).toBe(true);
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
