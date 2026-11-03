// A terminal tile's kitty graphics (PIE-1555): the commands come out of a program's output across reads, are answered as
// a kitty terminal would, keep the program's own ids per tile, and draw as the tile's placements, cut to its rows. Then a
// real program (the showcase's made-up icat) in a real terminal tile: its picture is the tile's, and goes with it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import xterm from "@xterm/headless";
import { GraphicsFeed, KittyApcReader, TileGraphics, windowOpsReply, type Anchor } from "../src/desk/tile-graphics";
import { PtyPane } from "../src/desk/pty";
import { until } from "./scratch";

/** A 2×1 RGBA image, as a program sends one. */
const RGBA = Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]).toString("base64");
const geo = { cellW: 10, cellH: 20, cols: 40, rows: 10, alt: false };
/** An anchor on buffer line `line`, column `col`, that can be let go. */
const anchor = (line: number, col = 0) => { let gone = false; return { a: { col, line: () => line, alive: () => !gone, dispose: () => { gone = true; } } satisfies Anchor, drop: () => { gone = true; } }; };

describe("taking graphics commands out of the stream", () => {
  test("text passes through; a command split across reads comes out whole, in order", () => {
    const r = new KittyApcReader();
    const all = [...r.feed("before \x1b_Ga=T,f=32,s=2,v=1;AAA"), ...r.feed("A\x1b"), ...r.feed("\\ after")];
    expect(all).toEqual([{ text: "before " }, { apc: "a=T,f=32,s=2,v=1;AAAA" }, { text: " after" }]);
  });
  test("a read ending on the first bytes of a command holds them back, and gives them back when it isn't one", () => {
    const r = new KittyApcReader();
    expect(r.feed("plain\x1b_")).toEqual([{ text: "plain" }]);
    expect(r.feed("Xrest")).toEqual([{ text: "\x1b_Xrest" }]);
    expect(r.feed("\x1b[31mred")).toEqual([{ text: "\x1b[31mred" }]);
  });
});

describe("a tile's graphics", () => {
  test("a query is answered OK (q=0), a quiet one is not, a bad image is an error", () => {
    const g = new TileGraphics(), said: string[] = [];
    g.command("i=31,s=1,v=1,a=q,t=d,f=24;AAAA", geo, s => said.push(s));
    g.command("i=32,s=1,v=1,a=q,t=d,f=24,q=2;AAAA", geo, s => said.push(s));
    g.command("i=33,a=q,f=100;AAAA", geo, s => said.push(s));
    expect(said[0]).toBe("\x1b_Gi=31;OK\x1b\\");
    expect(said).toHaveLength(2);
    expect(said[1]).toMatch(/^\x1b_Gi=33;EBADPNG/);
    expect(g.counts).toEqual({ images: 0, placements: 0 });
  });

  test("a=T keeps the image under the program's id, places it at the cursor, and moves the cursor past it", () => {
    const g = new TileGraphics();
    const r = g.command(`a=T,f=32,s=2,v=1,i=5,c=4,r=3;${RGBA}`, geo, null);
    expect(r.move).toBe("\x1bD\x1bD\x1b[4C");
    const { a } = anchor(12, 3);
    r.place!(a, false);
    const [p] = g.placements(10, 40, 10, false);
    expect(p).toMatchObject({ col: 3, row: 2, cols: 4, rows: 3, key: "g5.-1" });
    // The same id in another tile is another image: each tile's graphics are its own.
    expect(new TileGraphics().command("a=p,i=5", geo, s => expect(s).toContain("ENOENT")).place).toBeNull();
  });

  test("its box comes from its pixels in the tile's cells when the command gives none", () => {
    const g = new TileGraphics();
    const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(95, 16); png.writeUInt32BE(41, 20);
    const r = g.command(`a=T,f=100,i=2,C=1;${png.toString("base64")}`, geo, null);
    expect(r.move).toBe("");
    r.place!(anchor(0).a, false);
    expect(g.placements(0, 40, 10, false)[0]).toMatchObject({ cols: 10, rows: 3 });
  });

  test("scrolled half away, it shows its lower half; past the tile's edge, it's cut there; its line gone, it goes", () => {
    const g = new TileGraphics();
    const r = g.command(`a=T,f=32,s=2,v=1,i=1,c=20,r=4;${RGBA}`, geo, null), { a, drop } = anchor(8, 30);
    r.place!(a, false);
    const [p] = g.placements(10, 40, 10, false);
    expect(p).toMatchObject({ row: 0, rows: 2, col: 30, cols: 10 });
    expect(p!.crop).toBeDefined();
    drop();
    expect(g.placements(10, 40, 10, false)).toEqual([]);
    expect(g.counts.placements).toBe(0);
  });

  test("chunks (m=1) make one image; a=d,d=I frees it; a cleared screen takes what's on it", () => {
    const g = new TileGraphics();
    const half = RGBA.length / 2;
    g.command(`a=t,f=32,s=2,v=1,i=9,m=1;${RGBA.slice(0, half)}`, geo, null);
    g.command(`m=0;${RGBA.slice(half)}`, geo, null);
    expect(g.counts.images).toBe(1);
    g.command("a=p,i=9,c=2,r=1", geo, null).place!(anchor(3).a, false);
    g.command("a=p,i=9,c=2,r=1,p=4", geo, null).place!(anchor(30).a, false);
    g.cleared(false, 20);
    expect(g.counts.placements).toBe(1);
    g.command("a=d,d=I,i=9", geo, null);
    expect(g.counts).toEqual({ images: 0, placements: 0 });
  });

  test("the alternate screen's pictures go when the program leaves it", () => {
    const g = new TileGraphics();
    g.command(`a=T,f=32,s=2,v=1,i=1,c=2,r=1;${RGBA}`, { ...geo, alt: true }, null).place!(anchor(0).a, true);
    expect(g.placements(0, 40, 10, true)).toHaveLength(1);
    expect(g.placements(0, 40, 10, false)).toEqual([]);
    expect(g.counts.placements).toBe(0);
  });

  test("the size in pixels is answered as kitty answers it", () => {
    expect(windowOpsReply(14, geo)).toBe("\x1b[4;200;400t");
    expect(windowOpsReply(16, geo)).toBe("\x1b[6;20;10t");
    expect(windowOpsReply(18, geo)).toBeNull();
  });
});

describe("feeding the emulator in stream order (Codex on #1260)", () => {
  const { Terminal } = xterm as unknown as { Terminal: new (o: Record<string, unknown>) => any };
  /** A headless xterm, a tile's graphics and the feed between them; RIS resets the graphics, as the tile's handler does. */
  const rig = (on: boolean) => {
    const term = new Terminal({ cols: 40, rows: 10, scrollback: 100, allowProposedApi: true }), graphics = new TileGraphics();
    term.parser.registerEscHandler({ final: "c" }, () => { graphics.reset(); return false; });
    const feed = new GraphicsFeed(term, graphics, { on: () => on, geometry: () => ({ ...geo, alt: false }) });
    const send = (...reads: string[]) => new Promise<void>(done => reads.forEach((r, i) => feed.feed(Buffer.from(r, "latin1"), r, null, i === reads.length - 1 ? done : undefined)));
    const line = (y: number) => term.buffer.active.getLine(y)?.translateToString(true) ?? "";
    return { term, graphics, send, line };
  };

  for (const on of [false, true]) test(`an escape cut across reads reaches the emulator whole (graphics ${on ? "on" : "off"})`, async () => {
    const r = rig(on);
    await r.send("\x1b", "[31mRED\x1b", "[0m plain");
    expect(r.line(0)).toBe("RED plain");
  });

  test("a=T then a=d in one read: the picture is gone; RIS then a picture: the picture stays", async () => {
    const a = rig(true);
    await a.send(`\x1b_Ga=T,f=32,s=2,v=1,i=4,c=2,r=1;${RGBA}\x1b\\\x1b_Ga=d,d=a\x1b\\`);
    expect(a.graphics.placements(0, 40, 10, false)).toEqual([]);
    const b = rig(true);
    await b.send(`\x1bc\x1b_Ga=T,f=32,s=2,v=1,i=4,c=2,r=1;${RGBA}\x1b\\after`);
    expect(b.graphics.placements(0, 40, 10, false)).toHaveLength(1);
    expect(b.line(0)).toBe("  after");
  });
});

describe("a program in a terminal tile", () => {
  let dir = "";
  const saved = process.env.EP0CH_STATE;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ep0ch-tilegfx-")); process.env.EP0CH_STATE = join(dir, "state"); });
  afterEach(() => { if (saved === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = saved; rmSync(dir, { recursive: true, force: true }); });
  const icat = resolve(import.meta.dir, "../src/showcase/icat.ts");
  /** Enough of a desk for a tile to draw in: kitty graphics on or off, 9×18 cells. */
  const desk = (graphics: boolean) => ({ ctx: { graphics, t: { cellW: 9, cellH: 18 }, flash() {} }, redraw() {} }) as any;

  test("icat asks, is answered, and its picture is the tile's: placed at its line, cut at the tile's edge", async () => {
    const p = new PtyPane({ cmd: [process.execPath, icat], label: "icat" }), d = desk(true);
    p.init(d);
    try {
      p.render(60, 20, false, d);
      await until(() => p.text().some(l => l.includes("the plot plan")), "icat's caption");
      const view = p.render(60, 20, false, d);
      expect(view.placements, p.text().join("\n")).toHaveLength(1);
      const [pic] = view.placements!;
      // 320×160 pixels in 9×18 cells: 36 columns, 9 rows, from the top left where the cursor was.
      expect(pic).toMatchObject({ col: 0, row: 0, cols: 36, rows: 9 });
      // The caption is on the row after the picture, as a kitty terminal moves the cursor past it.
      expect(p.text().findIndex(l => l.includes("the plot plan"))).toBe(9);
      // A narrower tile cuts it at its edge.
      const narrow = p.render(20, 20, false, d).placements![0]!;
      expect(narrow.cols).toBeLessThanOrEqual(20);
    } finally { p.kill(); }
  }, 20_000);

  test("without kitty graphics, nothing is answered and the program says so in text", async () => {
    const p = new PtyPane({ cmd: [process.execPath, icat], label: "icat" }), d = desk(false);
    p.init(d);
    try {
      p.render(80, 10, false, d);
      await until(() => p.text().some(l => l.includes("doesn't draw kitty images")), "icat's fallback");
      expect(p.render(80, 10, false, d).placements).toBeUndefined();
    } finally { p.kill(); }
  }, 20_000);
});
