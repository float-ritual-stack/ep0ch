// PIE-419: selecting and copying text in every reader, by mouse and by keys, and by agents through
// `act`. Selecting never copies; only y, Y or the copy control do, with OSC 52. A drag that starts on a
// link selects; a click still follows it. Fictional notes, against throwaway services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import { DeliveryBoard } from "../src/desk/delivery";
import { River } from "../src/river/river";
import { MainMenu } from "../src/screens";
import { SocketBoard, type Actor } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { cellsOf, Gesture, lineAt, osc52, paintRange, rowsOf, Selection, SELECT_BG } from "../src/surface/selection";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const AGENT: Actor = { kind: "agent", id: "claude-419" };
type Rect = { col: number; row: number; cols: number; rows: number };

describe("the selection model", () => {
  test("OSC 52: ESC ] 52 ; c ; base64 BEL, for any text", () => {
    expect(osc52("Sow peas")).toBe("\x1b]52;c;U293IHBlYXM=\x07");
    const t = "Beete — Erbsen ✿\nzweite Zeile";
    expect(osc52(t)).toBe(`\x1b]52;c;${Buffer.from(t, "utf8").toString("base64")}\x07`);
  });

  test("the highlight keeps the line's own colours, survives resets inside it, and restores the line after", () => {
    const line = `\x1b[38;2;1;2;3mab\x1b[0mcd\x1b[1mef\x1b[22mgh`;
    const out = paintRange(line, 1, 5, SELECT_BG);
    expect(cellsOf(out).join("")).toBe("abcdefgh");
    expect(plain(out)).toBe("abcdefgh");
    // The tint is put back after the reset at `c`, and after `ef`'s bold; the colour state before it is restored after.
    expect(out).toBe(`\x1b[38;2;1;2;3ma${SELECT_BG}b\x1b[0m${SELECT_BG}cd\x1b[1m${SELECT_BG}e\x1b[0m\x1b[1mf\x1b[22mgh`);
  });

  test("text: rows joined as drawn, without the margin or trailing blanks", () => {
    const rows = rowsOf(["Title   ", " first row   ", " second row"], r => (r === 0 ? 0 : 1));
    expect(new Selection({ row: 1, col: 7 }, { row: 2, col: 3 }).text(rows)).toBe("row\nsec");
    // Backwards is the same selection; a margin cell selects nothing on its row.
    expect(new Selection({ row: 2, col: 0 }, { row: 1, col: 0 }).text(rows)).toBe("first row\n");
    // A row selected whole (triple click) leaves out a list's hanging indent.
    expect(lineAt(rowsOf(["   semantics as drawn   "], () => 1), 0).text(rowsOf(["   semantics as drawn   "], () => 1))).toBe("semantics as drawn");
  });

  test("a press and release on one cell is a click; a drag isn't; quick presses on a cell count up to three", () => {
    const g = new Gesture();
    expect(g.press(3, 4, 1000)).toBe(1);
    expect(g.release(3, 4)).toEqual({ click: true, moved: false, n: 1 });
    expect(g.press(3, 4, 1100)).toBe(2);
    expect(g.release(3, 4).click).toBe(false);
    expect(g.press(3, 4, 1200)).toBe(3);
    g.release(3, 4);
    expect(g.press(3, 4, 5000)).toBe(1);                     // too late: a new click
    expect(g.drag(3, 4)).toBe(false);                         // not off the cell yet
    expect(g.drag(5, 4)).toBe(true);
    expect(g.release(5, 4)).toEqual({ click: false, moved: true, n: 1 });
    g.press(3, 4, 6000); g.release(3, 4); g.forget();
    expect(g.press(3, 4, 6050)).toBe(1);                      // the click acted: not a double click
  });
});

describe("the note surface selects and copies, without a service", () => {
  const TEXT = "Plan the allotment\nSow peas early by the fence.\nWater the seedlings every morning.\n\n- dig the bed\n- buy canes";
  const note = (text = TEXT): Msg => ({ id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, props: {} });
  const setup = () => {
    const copies: string[] = [], flashes: string[] = [];
    const h: SurfaceHost = {
      ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash: (m: string) => flashes.push(m), copy: (t: string) => copies.push(t), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
      redraw() {}, navigate() {},
    };
    const s = new NoteSurface();
    s.show(note(), h);
    const draw = () => s.render(60, 20, h).lines;
    const at = (text: string, lines = draw()) => {
      const y = lines.findIndex(l => plain(l).includes(text));
      if (y < 0) throw new Error(`${text} isn't drawn`);
      return { x: plain(lines[y]!).indexOf(text), y };
    };
    return { s, h, copies, flashes, draw, at };
  };

  test("a drag selects and copies nothing; y copies what's drawn and says how much", () => {
    const { s, h, copies, flashes, at } = setup();
    const a = at("Sow peas"), z = at("fence.");
    s.press(a.x, a.y, h); s.drag(a.x + 3, a.y, h); s.drag(z.x + 5, z.y, h); s.release(z.x + 5, z.y, h);
    expect(copies).toEqual([]);                                    // selecting never copies
    expect(s.describe().selection?.text).toBe("Sow peas early by the fence.");
    s.key(char("y"), h);
    expect(copies).toEqual(["Sow peas early by the fence."]);
    expect(flashes.at(-1)).toBe("copied 28 chars");
  });

  test("the selection is painted, stays on its text as the note scrolls, and a copy control appears", () => {
    const { s, h, draw, at } = setup();
    const a = at("Water");
    s.press(a.x, a.y, h); s.drag(a.x + 4, a.y, h); s.release(a.x + 4, a.y, h);
    const lines = draw();
    expect(lines[a.y]).toContain(SELECT_BG);
    expect(lines.map(plain).join("\n")).toContain("── 5 chars [y copy] [Y source]");
    const rule = plain(lines.find(l => plain(l).includes("[y copy]"))!);
    expect([...rule].length).toBe(60);
    expect(rule).toEndWith("──");                                     // filled to the edge, not cut with …
    // Scrolled by the wheel, the tint moves with the text.
    s.wheel(1, h);
    const after = draw(), y = after.findIndex(l => plain(l).includes("Water the"));
    if (y >= 0) expect(after[y]).toContain(SELECT_BG);
    expect(s.describe().selection?.text).toBe("Water");
  });

  test("the copy control copies, as y does", () => {
    const { s, h, copies, draw, at } = setup();
    const a = at("seedlings");
    s.press(a.x, a.y, h); s.drag(a.x + 8, a.y, h); s.release(a.x + 8, a.y, h);
    const c = at("[y copy]", draw());
    s.press(c.x + 2, c.y, h); s.release(c.x + 2, c.y, h);
    expect(copies).toEqual(["seedlings"]);
    const src = at("[Y source]", draw());
    s.press(src.x + 2, src.y, h); s.release(src.x + 2, src.y, h);
    expect(copies).toEqual(["seedlings", "seedlings"]);            // plain words: the source reads the same
  });

  test("double click selects a word, triple the row; neither copies", () => {
    const { s, h, copies, at } = setup();
    const a = at("seedlings");
    s.press(a.x + 2, a.y, h); s.release(a.x + 2, a.y, h);
    expect(s.describe().selection).toBeNull();                     // one click selects nothing
    s.press(a.x + 2, a.y, h); s.release(a.x + 2, a.y, h);
    expect(s.describe().selection?.text).toBe("seedlings");
    s.press(a.x + 2, a.y, h); s.release(a.x + 2, a.y, h);
    expect(s.describe().selection?.text).toBe("Water the seedlings every morning.");
    expect(copies).toEqual([]);
  });

  test("v starts where the reading is; h j k l and End move it; y copies; esc lets go", () => {
    const { s, h, copies, flashes } = setup();
    s.render(60, 20, h);
    s.key(char("y"), h);
    expect(flashes.at(-1)).toContain("nothing is selected");
    expect(copies).toEqual([]);
    s.key(char("v"), h);
    expect(s.describe().selection).toMatchObject({ text: "S", keys: true });
    for (const k of ["l", "l"]) s.key(char(k), h);
    expect(s.describe().selection?.text).toBe("Sow");
    s.key(char("j"), h); s.key({ kind: "end" }, h);
    expect(s.describe().selection?.text).toBe("Sow peas early by the fence.\nWater the seedlings every morning.");
    expect(s.scroll).toBe(0);                                      // j extended the selection; it didn't scroll
    s.key(char("y"), h);
    expect(copies).toEqual(["Sow peas early by the fence.\nWater the seedlings every morning."]);
    s.key({ kind: "esc" }, h);
    expect(s.describe().selection).toBeNull();
  });

  test("esc and a click elsewhere let go of a mouse selection; j k still scroll it", () => {
    const { s, h, at } = setup();
    const a = at("Water");
    s.press(a.x, a.y, h); s.drag(a.x + 4, a.y, h); s.release(a.x + 4, a.y, h);
    expect(s.key({ kind: "esc" }, h)).toBe(true);
    expect(s.describe().selection).toBeNull();
    s.press(a.x, a.y, h); s.drag(a.x + 4, a.y, h); s.release(a.x + 4, a.y, h);
    const b = at("dig");
    s.press(b.x, b.y, h); s.release(b.x, b.y, h);
    expect(s.describe().selection).toBeNull();
  });

  test("Y copies the source: exactly the words when they read the same, whole lines when the markup differs", () => {
    const { s, h, copies, flashes } = setup();
    s.show(note("Plan\nSee **bold words** here.\nNext line."), h);
    s.render(60, 20, h);
    const lines = s.render(60, 20, h).lines, y = lines.findIndex(l => plain(l).includes("bold words"));
    const x = plain(lines[y]!).indexOf("See");
    s.press(x, y, h); s.drag(x + 7, y, h); s.release(x + 7, y, h);
    s.key(char("Y"), h);
    expect(copies.at(-1)).toBe("See **bold words** here.");        // the drawn "See bold" isn't in the source: its line is
    expect(flashes.at(-1)).toBe("copied 24 chars of source · whole line 2");
    s.key(char("y"), h);
    expect(copies.at(-1)).toBe("See bold");
    const n = plain(lines[y + 1]!).indexOf("Next");
    s.press(n, y + 1, h); s.drag(n + 3, y + 1, h); s.release(n + 3, y + 1, h);
    s.key(char("Y"), h);
    expect(copies.at(-1)).toBe("Next");
    expect(flashes.at(-1)).toBe("copied 4 chars of source");
  });

  test("an agent's line in the header doesn't take away a selection that starts on the title", async () => {
    const { s, h, draw, at } = setup();
    const t = at("Plan the allotment"), z = at("Sow peas");
    s.press(t.x, t.y, h); s.drag(t.x + 1, t.y, h); s.drag(z.x + 2, z.y, h); s.release(z.x + 2, z.y, h);
    const before = s.describe().selection?.text;
    expect(before).toStartWith("Plan the allotment");
    expect(before).toEndWith("Sow");
    await s.act("fold", { all: true }, h, AGENT);                  // says so in the header: one more row
    expect(draw().map(plain).join("\n")).toContain("an agent (claude-419)");
    // Still there, its ends on the same text (the rows between read as they're drawn now).
    const after = s.describe().selection?.text;
    expect(after).toStartWith("Plan the allotment");
    expect(after).toEndWith("\nSow");
  });

  test("an agent selects by text or by lines, gets the text back, and never touches the person's selection or clipboard", async () => {
    const { s, h, copies, flashes, at } = setup();
    const a = at("Sow");
    s.press(a.x, a.y, h); s.drag(a.x + 2, a.y, h); s.release(a.x + 2, a.y, h);
    expect(await s.act("select", { text: "Water the seedlings" }, h, AGENT)).toMatchObject({ chars: 19, text: "Water the seedlings" });
    expect(s.describe().selection?.text).toBe("Sow");               // the person's, as it was
    expect(s.describe().agentSelection).toMatchObject({ id: "claude-419", text: "Water the seedlings" });
    expect(await s.act("select.copy", {}, h, AGENT)).toEqual({ copied: 19, text: "Water the seedlings", clipboard: false });
    expect(copies).toEqual([]);
    expect(flashes.at(-1)).toStartWith("an agent (claude-419) · copied 19 chars");
    expect(await s.act("select", { line: 2, to: 3 }, h, AGENT)).toMatchObject({ text: "Sow peas early by the fence.\nWater the seedlings every morning.", lines: [2, 3] });
    expect(await s.act("select.copy", { source: true }, h, AGENT)).toMatchObject({ text: "Sow peas early by the fence.\nWater the seedlings every morning." });
    await expect(s.act("select", { text: "not in the note" }, h, AGENT)).rejects.toThrow("isn't drawn");
    await expect(s.act("select", {}, h, AGENT)).rejects.toThrow("say what to select");
    expect(s.describe().agent).toMatchObject({ id: "claude-419" });
    expect(await s.act("select.clear", {}, h, AGENT)).toEqual({ cleared: true });
    expect(s.describe().selection?.text).toBe("Sow");
    // The person's own select.copy is their y: it goes to their clipboard.
    expect(await s.act("select.copy", {}, h, { kind: "user" } as Actor)).toMatchObject({ copied: 3, clipboard: true });
    expect(copies).toEqual(["Sow"]);
  });
});

describe.skipIf(!outliner)("selecting in the board, the desk and the river, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, hub: any, beans: any, card: any;
  let key: (k: Key) => void = () => {};
  const writes: string[] = [];
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: "test-agent-419" }) as Promise<any>;
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const message = () => (app as any).message as string;
  /** Every clipboard write the door made, decoded from the OSC 52 it wrote to the terminal. */
  const copied = () => [...writes.join("").matchAll(/\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/g)].map(m => Buffer.from(m[1]!, "base64").toString("utf8"));
  const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
  const drag = (a: { x: number; y: number }, z: { x: number; y: number }) => { mouse("down", a.x, a.y); mouse("drag", a.x + 1, a.y); mouse("drag", z.x, z.y); mouse("up", z.x, z.y); };
  const click = (a: { x: number; y: number }) => { mouse("down", a.x, a.y); mouse("up", a.x, a.y); };
  /** Where `text` starts on screen inside `r`. */
  const where = (lines: string[], text: string, r: Rect) => {
    for (let y = r.row; y < r.row + r.rows; y++) {
      const l = plain(lines[y] ?? ""), x = l.indexOf(text, r.col);
      if (x >= 0 && x + text.length <= r.col + r.cols) return { x, y };
    }
    throw new Error(`"${text}" isn't drawn in ${JSON.stringify(r)}:\n${lines.slice(r.row, r.row + r.rows).map(plain).join("\n")}`);
  };
  const frame = () => b.render(B().ctx).lines;
  const LINE = () => "Sow peas, see Stake the beans first.";

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    hub = await create(null, "Allotment board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    beans = await create(null, "Stake the beans\nCanes along the fence.");
    card = await create(null, `Plan the allotment [stage::queued]\nSow peas, see ((${beans.id})) first.\nWater the seedlings every morning.`);
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write(s: string) { writes.push(s); }, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    b = new DeliveryBoard(hub.id);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 1 && B().lanes.every((l: any) => l.items?.length), "the lanes", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  /** The card in a detail, its link drawn by title; the detail and its frame. */
  const openCard = async () => {
    await act("open", { id: card.id }, "detail");
    const d = B().details.find((x: any) => x.msg?.id === card.id);
    await until(() => !!d && !d.msg.partial && plain(frame().join("\n")).includes(LINE()), "the card drawn with its link's title");
    const region = `detail${B().details.indexOf(d)}`;
    B().focus = region;
    d.surface.clearSelections();                                    // each test starts with nothing selected
    await Bun.sleep(500);                                           // no press before counts toward a double click
    return { d, r: B().rects.get(region) as Rect };
  };

  test("a drag selects and writes nothing; y writes the drawn text (the link as its title) with OSC 52", async () => {
    const { d, r } = await openCard();
    const a = where(frame(), "Sow peas", r), z = where(frame(), "first.", r);
    writes.length = 0;
    drag(a, { x: z.x + 5, y: z.y });
    expect(copied()).toEqual([]);
    expect(d.surface.describe().selection.text).toBe(LINE());
    key(char("y"));
    expect(copied()).toEqual([LINE()]);
    expect(writes.join("")).toContain(`\x1b]52;c;${Buffer.from(LINE()).toString("base64")}\x07`);
    expect(message()).toBe(`copied ${LINE().length} chars`);
    key({ kind: "esc" });
    expect(d.surface.describe().selection).toBeNull();
    expect(B().focus).toMatch(/^detail/);                           // the first esc only let go of the selection
  });

  test("Y writes the source: the link's markup, not its title", async () => {
    const { r } = await openCard();
    const a = where(frame(), "Sow peas", r), z = where(frame(), "first.", r);
    writes.length = 0;
    drag(a, { x: z.x + 5, y: z.y });
    key(char("Y"));
    expect(copied()).toEqual([`Sow peas, see ((${beans.id})) first.`]);
    expect(message()).toContain("of source · whole line 2");
  });

  test("a drag that starts on a link selects and doesn't follow it; a click on it still follows it", async () => {
    const { d, r } = await openCard();
    const l = where(frame(), "Stake the beans", r);
    writes.length = 0;
    drag({ x: l.x + 2, y: l.y }, { x: l.x + 6, y: l.y });
    await Bun.sleep(200);
    expect(d.msg.id).toBe(card.id);
    expect(d.surface.describe().selection.text).toBe("ake t");
    expect(copied()).toEqual([]);
    click({ x: l.x + 2, y: l.y });
    await until(() => d.msg?.id === beans.id, "the link to open on a click");
    expect(d.surface.describe().selection).toBeNull();
  });

  test("double and triple clicks select a word and a row", async () => {
    const { d, r } = await openCard();
    const w = where(frame(), "seedlings", r);
    click({ x: w.x + 3, y: w.y }); click({ x: w.x + 3, y: w.y });
    expect(d.surface.describe().selection.text).toBe("seedlings");
    click({ x: w.x + 3, y: w.y });
    expect(d.surface.describe().selection.text).toBe("Water the seedlings every morning.");
  });

  test("the keyboard mode: v, then j and End, then y", async () => {
    const { d } = await openCard();
    writes.length = 0;
    key(char("v")); key(char("j")); key({ kind: "end" });
    expect(d.surface.describe().selection).toMatchObject({ keys: true, text: `${LINE()}\nWater the seedlings every morning.` });
    key(char("y"));
    expect(copied()).toEqual([`${LINE()}\nWater the seedlings every morning.`]);
    key({ kind: "esc" });
    expect(d.surface.describe().selection).toBeNull();
  });

  test("text selected before C is the passage the comment quotes", async () => {
    const { d, r } = await openCard();
    const w = where(frame(), "seedlings every", r);
    drag(w, { x: w.x + "seedlings every".length - 1, y: w.y });
    key(char("C"));
    await until(() => !!d.surface.session, "the comment session");
    expect(d.surface.session.passage.quote).toBe("seedlings every");
    expect(d.surface.describe().selection).toBeNull();
    d.surface.closeSession();
  });

  test("an agent's select and select.copy through act: attributed, its own, and never the person's clipboard", async () => {
    const { d, r } = await openCard();
    const a = where(frame(), "Water", r);
    drag(a, { x: a.x + 4, y: a.y });
    writes.length = 0;
    expect(await act("select", { text: "Stake the beans" }, "detail")).toMatchObject({ chars: 15, text: "Stake the beans" });
    expect(await act("select.copy", { source: true }, "detail")).toMatchObject({ text: LINE().replace("Stake the beans", `((${beans.id}))`), clipboard: false });
    expect(copied()).toEqual([]);
    expect(message()).toStartWith("an agent (test-agent-419) · copied");
    expect(d.surface.describe().selection.text).toBe("Water");
    expect(plain(frame().join("\n"))).toContain("an agent (test-agent-419) copied");
  });

  test("a float still moves by its title and resizes by its corner; its text selects by drag", async () => {
    const { d } = await openCard();
    B().focus = `detail${B().details.indexOf(d)}`;
    key(char("o"));
    await until(() => B().floats.length > 0, "the float");
    const f = B().floats.at(-1);
    frame();
    const was = { ...f.rect };
    drag({ x: was.col + 4, y: was.row }, { x: was.col + 10, y: was.row + 2 });
    expect([f.rect.col, f.rect.row]).toEqual([was.col + 10 - 4, was.row + 2]);
    const r = f.rect, corner = { x: r.col + r.cols - 1, y: r.row + r.rows - 1 };
    drag(corner, { x: corner.x + 5, y: corner.y + 1 });
    expect([f.rect.cols, f.rect.rows]).toEqual([was.cols + 5, was.rows + 1]);
    await until(() => plain(frame().join("\n")).includes("Water the seedlings"), "the float drawn");
    const w = where(frame(), "Water", f.rect);
    drag(w, { x: w.x + 4, y: w.y });
    expect(f.pane.surface.describe().selection.text).toBe("Water");
    key(char("x"));
  });

  test("the desk's reader selects by drag, and y writes it", async () => {
    const desk = new Desk();
    app.push(desk);
    try {
      await app.act({ action: "open", args: { id: card.id }, as: "test-agent-419" });
      const reader = () => [...(desk as any).panes.entries()].find(([, p]: any) => p.kind === "reader") as [number, any];
      const lines = () => desk.render((desk as any).ctx).lines;
      const r = () => (desk as any).placed.rects.get(reader()[0]) as Rect;
      await until(() => plain(lines().join("\n")).includes(LINE()), "the desk reader drawn");
      await Bun.sleep(500);
      const a = where(lines(), "Water", r());
      writes.length = 0;
      drag(a, { x: a.x + 8, y: a.y });
      expect(copied()).toEqual([]);
      expect(reader()[1].surface.describe().selection.text).toBe("Water the");
      key(char("y"));
      expect(copied()).toEqual(["Water the"]);
    } finally { app.pop(); }
  });

  test("a river column selects by drag (from a link too, which doesn't open), and y writes it", async () => {
    app.pop();
    const river = new River();
    app.push(river);
    const R = () => river as any;
    try {
      await until(() => !!R().cols[0]?.panes[0].items, "the Library", 10_000);
      await app.act({ action: "open", args: { id: card.id }, as: "test-agent-419" });
      const lines = () => river.render(app).lines;
      await until(() => plain(lines().join("\n")).includes(LINE()), "the card's column");
      await Bun.sleep(500);
      const cols = R().cols.length;
      lines();
      const h = R().hits.find((x: any) => R().cols[x.col].panes[x.pane].source?.id === card.id);
      const l = where(lines(), "Stake the beans", h.rect);
      writes.length = 0;
      drag({ x: l.x, y: l.y }, { x: l.x + 4, y: l.y });
      await Bun.sleep(150);
      expect(R().cols.length).toBe(cols);                            // the link didn't open a column
      expect(copied()).toEqual([]);
      key(char("y"));
      expect(copied()).toEqual(["Stake"]);
      key({ kind: "esc" });
      expect(R().sel).toBeNull();
    } finally { app.pop(); }
  });
});
