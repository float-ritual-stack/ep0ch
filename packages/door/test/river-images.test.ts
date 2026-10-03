// A river column draws a note's images as a reader tile does: its digest lays them out whenever Kitty graphics are
// on, and the column hands their placements to the desk, cut to what it shows (scrolled, folded, closed). When
// graphics are off the image's line says why. Fictional notes and a generated PNG; scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import type { Placement } from "../src/kitty";
import { media } from "../src/media";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { encodePng } from "../src/vga";
import { outliner, Scratch, until } from "./scratch";
import { view } from "./river-view";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const dir = mkdtempSync(join(tmpdir(), "ep0ch-river-img-"));
const PNG = join(dir, "seed-tray.png");
writeFileSync(PNG, encodePng({ width: 400, height: 200, data: Buffer.alloc(400 * 200 * 4, 0x80) }));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ready = () => until(() => media(PNG, "img").state === "ready", "the seed tray image");
const note = (text: string): Msg => ({ id: "31111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} });

function host(graphics: boolean, kitty: boolean): SurfaceHost {
  return {
    ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty }, graphics } as any,
    redraw() {}, navigate() {},
  };
}

describe("a digest lays out a note's images when graphics are on", () => {
  const text = `Seed tray\nBefore the photo.\n[img:: ${PNG}]\nAfter the photo.`;

  test("graphics on: the image has rows of its own and a placement on them, and no 'off' label", async () => {
    await ready();
    const s = new NoteSurface(), h = host(true, true), m = note(text);
    s.show(m, h);
    const dg = s.digest(m, 80, h);
    expect(dg.placements).toHaveLength(1);
    const p = dg.placements[0]!;
    const label = dg.lines.findIndex(l => plain(l).includes("seed-tray.png"));
    expect(label).toBeGreaterThan(0);
    // The image's rows are blank, right above its caption, and the placement sits on them.
    expect(p.row + p.rows).toBe(label);
    expect(dg.lines.slice(p.row, label).every(l => plain(l).trim() === "")).toBe(true);
    expect(p.col).toBe(0);
    expect(p.cols).toBeGreaterThan(0);
    expect(dg.lines.join("\n")).not.toContain("graphics");
  });

  test("graphics off: no placements, and the line says why", async () => {
    await ready();
    const m = note(text);
    const none = new NoteSurface(), hn = host(false, false);
    none.show(m, hn);
    const dn = none.digest(m, 80, hn);
    expect(dn.placements).toEqual([]);
    expect(plain(dn.lines.join("\n"))).toContain("no Kitty graphics in this terminal");
    // A Kitty terminal turned to cells (alt+v) says so instead.
    const cells = new NoteSurface(), hc = host(false, true);
    cells.show(m, hc);
    const dc = cells.digest(m, 80, hc);
    expect(dc.placements).toEqual([]);
    expect(plain(dc.lines.join("\n"))).toContain("video: cells");
  });
});

describe.skipIf(!outliner)("a river column places its note's images, cut to what it shows", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, river: Desk;
  let photo: { id: string };
  let term: { info: { cols: number } } & Record<string, unknown>;
  const V = () => view(river);
  const frame = () => river.render(river.ctx);
  const images = (ps: Placement[] | undefined) => (ps ?? []).filter(p => p.key.includes("img:"));
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => river.dispatch.act({ action, args, tile }, USER);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    const filler = Array.from({ length: 80 }, (_, i) => `Row ${i + 1} under the photo.`).join("\n");
    photo = await board.request("create", { parentId: null, text: `Seed tray photos\n## Trays\n[img:: ${PNG}]\n${filler}`, author: "agent" });
    term = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: true } as { cols: number }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    river = openScreen("river") as Desk;
    app.push(new MainMenu()); app.push(river);
    await until(() => !!V().column(1)?.items?.length, "the Library", 10_000);
    await ready();
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("open, scroll, fold and close: the image is placed in the column, cropped, and taken away", async () => {
    expect(app.graphics).toBe(true);
    const r = (await app.act({ action: "open", args: { id: photo.id }, as: "river-img-agent" })) as { reader: string };
    await mine("tile.focus", {}, r.reader);
    await mine("tile.widen", {}, r.reader);
    const col = V().byNote(photo.id)!;
    let ps = images(frame().placements);
    expect(ps).toHaveLength(1);
    const rect = V().rectOf(col);
    const p = ps[0]!;
    // Inside the column's frame, under its title rows, and whole.
    expect(p.col).toBeGreaterThan(rect.col);
    expect(p.col + p.cols).toBeLessThanOrEqual(rect.col + rect.cols - 1);
    expect(p.row).toBeGreaterThan(rect.row);
    expect(p.row + p.rows).toBeLessThanOrEqual(rect.row + rect.rows - 1);
    expect(p.crop).toBeUndefined();
    // The image's rows are blank on screen: no "off" label drawn.
    expect(plain(frame().lines.join("\n"))).not.toContain("Kitty graphics off");

    // Scrolled so the image's top is cut: one row less, cropped from the top, at the column's first body row.
    const top = col.top;
    const firstRow = p.row - (p.row - rect.row - 1);      // the column's first inner row
    const by = p.row - firstRow + 1;
    await mine("column.scroll", { by }, r.reader);
    ps = images(frame().placements);
    expect(col.top).toBe(top + by);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.row).toBe(firstRow);
    expect(ps[0]!.rows).toBe(p.rows - 1);
    expect(ps[0]!.crop).toMatchObject({ x: 0, w: 400 });
    expect(ps[0]!.crop!.y).toBeGreaterThan(0);

    // Scrolled past it: gone.
    await mine("column.scroll", { by: p.rows + 2 }, r.reader);
    expect(images(frame().placements)).toEqual([]);
    await mine("column.scroll", { by: -100 }, r.reader);
    expect(images(frame().placements)).toHaveLength(1);

    // Folded under its heading: gone; unfolded: back.
    await mine("fold.toggle", { n: 1 }, r.reader);
    expect(images(frame().placements)).toEqual([]);
    await mine("fold.toggle", { n: 1 }, r.reader);
    expect(images(frame().placements)).toHaveLength(1);

    // Closed: gone.
    await mine("tile.close", {}, r.reader);
    expect(V().byNote(photo.id)).toBeUndefined();
    expect(images(frame().placements)).toEqual([]);
  });

  test("a short column drawn over a long one's peek paints its whole rect: none of the long one shows through", async () => {
    const short = await board.request("create", { parentId: null, text: "Off the clock\nMeta work, briefly.", author: "agent" });
    const words = Array.from({ length: 40 }, (_, i) => `Row ${i + 1} of the long seed list runs on past the edge of a peek, under the next column.`).join("\n");
    const longNote = await board.request("create", { parentId: null, text: `The long seed list\n${words}`, author: "agent" });
    const long = (await app.act({ action: "open", args: { id: longNote.id }, as: "river-img-agent" })) as { reader: string };
    await mine("tile.focus", {}, long.reader);
    const s = (await mine("open", { id: short.id })) as { reader: string };
    await mine("tile.focus", {}, s.reader);
    await mine("tile.widen", {}, s.reader);
    // An 80-column terminal: the short note wide, the long one squeezed to a peek beside it.
    term.info.cols = 80;
    const lc = V().byNote(longNote.id)!, sc = V().byNote(short.id)!;
    await until(() => !!sc.items, "the short note's replies");
    const f = frame();
    // The long note is a peek whose box runs under the short one, drawn after it.
    expect(V().coverOf(lc)).toBe("peek");
    const r = V().rectOf(sc);
    const inside = f.lines.slice(r.row, r.row + r.rows).map(l => [...plain(l)].slice(r.col, r.col + r.cols).join(""));
    expect(inside.join("\n")).toContain("Meta work, briefly.");
    // Under its last line, its rows are blank to its own frame: no text and no border of the peek under it.
    // Its last lines are its links, under its replies (the links tile's rows): blank after them.
    const links = inside.findIndex(l => l.includes("── ▾ links"));
    expect(links).toBeGreaterThan(inside.findIndex(l => l.includes("0 replies")));
    const end = inside.findIndex((l, i) => i > links && /^│ *│$/.test(l));
    expect(end).toBeGreaterThan(links);
    for (const l of inside.slice(end, -1)) expect(l).toMatch(/^│ *│$/);
    expect(inside.join("\n")).not.toContain("runs on");
    // Nor does any image: the short note has none, and a tile drawn over another takes away the placements under it.
    term.info.cols = 120;
    for (const p of f.placements ?? []) expect(p.col < r.col + r.cols && p.col + p.cols > r.col && p.row < r.row + r.rows && p.row + p.rows > r.row).toBe(false);
  });
});
