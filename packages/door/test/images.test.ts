// Images (PIE-532, PIE-494): the media line's grammar and its rewrite, the layout of a sized, placed or header
// image, the scaling that turns PNG, JPEG, WebP and GIF into PNGs no bigger than the box they're drawn in (with no
// system tool), and the dimming that keeps a bright image dark-first. Fictional images, drawn here; no outline is written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { heroBox, imageBox, coverCrop, mediaLines, renderDoc, type DocEnv } from "../src/doc";
import { inWindow } from "../src/kitty";
import { brightness, MAX_MEAN, media, mediaCache, parseMediaLine, rewriteMediaLine, sized, type ReadyMedia } from "../src/media";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const dir = mkdtempSync(join(tmpdir(), "ep0ch-images-"));
const state = mkdtempSync(join(tmpdir(), "ep0ch-images-state-"));
const was = process.env.EP0CH_STATE;
const file = (name: string) => join(dir, name);
const drawn = { create: { width: 1200, height: 600, channels: 3 as const, background: { r: 40, g: 30, b: 60 } } };
const ready = async (f: string) => { await until(() => media(file(f), "img").state !== "loading", f, 10_000); const m = media(file(f), "img"); if (m.state !== "ready") throw new Error(m.state === "error" ? m.reason : "loading"); return m; };
const meanOf = async (png: Buffer) => { const c = (await sharp(png).stats()).channels; return (0.2126 * c[0]!.mean + 0.7152 * c[1]!.mean + 0.0722 * c[2]!.mean) / 255; };

beforeAll(async () => {
  process.env.EP0CH_STATE = state;
  await sharp(drawn).png().toFile(file("wide.png"));
  await sharp(drawn).jpeg().toFile(file("wide.jpg"));
  await sharp(drawn).webp().toFile(file("wide.webp"));
  await sharp(drawn).gif().toFile(file("wide.gif"));
  await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 60, b: 20 } } }).png().toFile(file("small.png"));
  // A fictional page of paper: nearly white.
  await sharp({ create: { width: 800, height: 450, channels: 3, background: { r: 240, g: 236, b: 226 } } }).png().toFile(file("paper.png"));
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); rmSync(state, { recursive: true, force: true }); if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was; });

describe("the media line", () => {
  test("a path and the layout beside it, in any order, after an optional list mark", () => {
    expect(parseMediaLine("- [img::/p/a b.png] [size::40%] [align::center] [layout::hero] [fit::contain] [dim::0.6] [alt::the plot]")).toEqual({
      kind: "img", path: "/p/a b.png", size: { percent: 40 }, align: "center", layout: "hero", fit: "contain", dim: 0.6, alt: "the plot", problems: [],
    });
    expect(parseMediaLine("[height::8] [video:: ~/v.mp4]")).toMatchObject({ kind: "video", path: "~/v.mp4", height: 8 });
    expect(parseMediaLine("img:: /p/x.jpg")).toMatchObject({ kind: "img", path: "/p/x.jpg" });
    expect(parseMediaLine("[img::/p/x.jpg] [size::full]")!.size).toBe("full");
    expect(parseMediaLine("[img::/p/x.jpg] [size::30]")!.size).toEqual({ cells: 30 });
  });

  test("a path with brackets, an anchor at the end, the img:: form with layout after it, a key written twice", () => {
    expect(parseMediaLine("[img::shots/a [1].png]")).toMatchObject({ path: "shots/a [1].png" });
    expect(parseMediaLine("[img::a.png] ^abc")).toMatchObject({ path: "a.png" });
    expect(parseMediaLine("img:: a.png [size::40%]")).toMatchObject({ path: "a.png", size: { percent: 40 } });
    const twice = parseMediaLine("[img::a.png] [size::40%] [size::60%]")!;
    expect(twice.size).toEqual({ percent: 40 });
    expect(twice.problems).toEqual(["size is written twice: the first counts"]);
  });

  test("anything else on the line, or another property, makes it text; a bad value is said", () => {
    expect(parseMediaLine("look: [img::/p/x.jpg]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg] [type::note]")).toBeNull();
    expect(parseMediaLine("[img::/a.png] [img::/b.png]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg][size::40]")).toBeNull();
    expect(parseMediaLine("[img::/p/x.jpg] [size::huge] [align::up] [dim::2]")!.problems).toEqual(["size::huge isn't a size (cells, N% or full)", "align::up isn't left, center or right", "dim::2 isn't a number from 0 to 1"]);
  });

  test("rewritten: values replaced in place, new ones after, null takes one out, a second of a key goes; the anchor stays", () => {
    expect(rewriteMediaLine("  - [img::/a.png] [size::25%] [alt::x]", { size: "50%", align: "right" })).toBe("  - [img::/a.png] [size::50%] [alt::x] [align::right]");
    expect(rewriteMediaLine("[img::/a.png] [layout::hero]", { layout: null })).toBe("[img::/a.png]");
    expect(rewriteMediaLine("img:: /a.png", { size: "40" })).toBe("[img::/a.png] [size::40]");
    expect(rewriteMediaLine("img:: a.png [size::40%]", { size: "50%" })).toBe("[img::a.png] [size::50%]");
    expect(rewriteMediaLine("[img::a.png] [size::40%] [size::60%]", { size: "50%" })).toBe("[img::a.png] [size::50%]");
    expect(rewriteMediaLine("[img::shots/a [1].png] ^abc", { align: "center" })).toBe("[img::shots/a [1].png] [align::center] ^abc");
    expect(rewriteMediaLine("not an image", { size: "40" })).toBeNull();
  });

  test("one scan: not inside a fence or a figure; the first header counts", () => {
    const found = mediaLines(["[img::a.png] [layout::hero]", "```", "[img::b.png]", "```", "[img::c.png] [layout::hero]"]);
    expect([...found.keys()]).toEqual([0, 4]);
    expect(found.get(4)!.layout).toBeUndefined();
    expect(found.get(4)!.problems).toEqual(["another image is the header already"]);
  });
});

describe("layout", () => {
  const env: DocEnv = { width: 100, cellW: 10, cellH: 20, graphics: true, maxImageRows: 30, unfold: true };
  const m: ReadyMedia = { state: "ready", path: "/x", kind: "img", key: "k", width: 1000, height: 500, mean: 0.1 };
  const spec = (s: string) => parseMediaLine(`[img::/x] ${s}`)!;

  test("width as cells, a share or full; height in rows; aspect kept; capped; aligned", () => {
    expect(imageBox(m, spec("[size::50%]"), 100, env)).toEqual({ col: 0, cols: 50, rows: 13 });
    expect(imageBox(m, spec("[size::40] [align::right]"), 100, env)).toEqual({ col: 60, cols: 40, rows: 10 });
    expect(imageBox(m, spec("[size::full]"), 100, env)).toEqual({ col: 0, cols: 100, rows: 25 });
    expect(imageBox(m, spec("[height::5] [align::center]"), 100, env)).toEqual({ col: 40, cols: 20, rows: 5 });
    expect(imageBox(m, spec("[size::full] [height::10]"), 100, env)).toEqual({ col: 0, cols: 40, rows: 10 });
    expect(imageBox(m, spec("[size::full]"), 100, { ...env, maxImageRows: 10 })).toEqual({ col: 0, cols: 40, rows: 10 });
  });

  test("a header: whole when it fits under its cap; taller, cropped to fill, or whole and centred with fit::contain", () => {
    // 100 cells of 10 px: 1000 × 500 px, 25 rows of 20 px.
    expect(heroBox(m, spec(""), 100, 30, 10, 20)).toEqual({ col: 0, cols: 100, rows: 25 });
    expect(heroBox(m, spec(""), 100, 10, 10, 20)).toEqual({ col: 0, cols: 100, rows: 10, crop: { x: 0, y: 0.3, w: 1, h: 0.4 } });
    expect(heroBox(m, spec("[fit::contain]"), 100, 10, 10, 20)).toEqual({ col: 30, cols: 40, rows: 10 });
  });

  test("a cover crop keeps the box's shape, around the middle", () => {
    expect(coverCrop({ width: 1000, height: 500 }, 1000, 250)).toEqual({ x: 0, y: 0.25, w: 1, h: 0.5 });
    expect(coverCrop({ width: 1000, height: 500 }, 500, 500)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(coverCrop({ width: 1000, height: 500 }, 200, 100)).toBeUndefined();
  });

  test("cut to a window, a cropped image is cut inside its crop", () => {
    const p = { key: "a", image: { width: 400, height: 400, png: Buffer.alloc(0), key: "k" }, col: 0, row: 0, cols: 10, rows: 10, crop: { x: 0, y: 100, w: 400, h: 200 } };
    expect(inWindow(p, 5, 20)!.crop).toEqual({ x: 0, y: 200, w: 400, h: 100 });
    expect(inWindow(p, 0, 20)!.crop).toEqual(p.crop);
  });
});

describe("scaling, with no system tool (PIE-494)", () => {
  for (const f of ["wide.png", "wide.jpg", "wide.webp", "wide.gif"]) {
    test(`${f}: read, its size known, drawn from a PNG scaled down for the box (never up)`, async () => {
      const m = await ready(f);
      expect([m.width, m.height]).toEqual([1200, 600]);
      expect(brightness(m.mean)).toBe(1);                  // dark already: as it is
      // Ready with its first look made: a box 600 px wide is drawn from the 640 step at once.
      expect(sized(m, 600, 300)!.width).toBe(640);
      // A box 300 px wide is drawn from the 320 step; one 2000 px wide from the image's own 1200 (the 1280 step's).
      await until(() => sized(m, 300, 150)?.width === 320, "the 320 step", 10_000);
      await until(() => sized(m, 2000, 1000)?.width === 1200, "its own size, not bigger", 10_000);
      expect(sized(m, 300, 150)!.png.readUInt32BE(0)).toBe(0x89504e47);
      // The cache names each scaled PNG by the file's content, its step and its look, and leaves no part-written file.
      const names = readdirSync(mediaCache());
      expect(names.some(n => n.startsWith(`${m.key}-320-a`))).toBe(true);
      expect(names.some(n => n.endsWith(".tmp.png"))).toBe(false);
    });
  }

  test("its size is known from its header before it's decoded: its rows are kept while it loads, so nothing moves", async () => {
    await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 5, g: 5, b: 5 } } }).jpeg().toFile(file("fresh.jpg"));
    const env: DocEnv = { width: 80, cellW: 10, cellH: 20, graphics: true, maxImageRows: 40, unfold: true };
    const text = `Before\n[img::${file("fresh.jpg")}] [size::40]\nAfter`;
    const loading = renderDoc(text, env);
    expect(media(file("fresh.jpg"), "img")).toMatchObject({ state: "loading", width: 640, height: 480 });
    await ready("fresh.jpg");
    const loaded = renderDoc(text, env);
    expect(loaded.lines.length).toBe(loading.lines.length);
    expect(loaded.lines.findIndex(l => plain(l).includes("After"))).toBe(loading.lines.findIndex(l => plain(l).includes("After")));
    expect(loading.images).toHaveLength(0);
    expect(loaded.images).toHaveLength(1);
  });

  test("a PNG already small enough, and dark, is drawn as it is", async () => {
    const m = await ready("small.png");
    const png = sized(m, 400, 200)!;
    expect([png.width, png.height]).toEqual([200, 100]);
    expect(existsSync(join(mediaCache(), `${png.key}.png`))).toBe(false);
  });

  test("a bright image is dimmed in the same step, never drawn bright first; dim:: says how much instead", async () => {
    const m = await ready("paper.png");
    expect(m.mean).toBeGreaterThan(0.85);
    expect(brightness(m.mean)).toBeCloseTo(MAX_MEAN / m.mean, 1);
    // The first look is already dimmed: no PNG of it at full brightness was ever made.
    expect(await meanOf(sized(m, 600, 340)!.png)).toBeLessThanOrEqual(MAX_MEAN + 0.03);
    expect(sized(m, 600, 340, { dim: 0 })).toBeNull();
    // [dim::0] keeps it as it is; [dim::0.6] draws it at 40%.
    expect(brightness(m.mean, 0)).toBe(1);
    expect(brightness(m.mean, 0.6)).toBe(0.4);
    await until(() => !!sized(m, 600, 340, { dim: 0.6 }), "dim 0.6", 10_000);
    expect(await meanOf(sized(m, 600, 340, { dim: 0.6 })!.png)).toBeCloseTo(m.mean * 0.4, 1);
  });

  test("the cap is measured over the part drawn (a header's crop), a transparent pixel counting as the dark ground", async () => {
    // A white sky over a black field: dark on the whole, bright where a header crops it.
    const sky = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#000"/><rect width="400" height="100" fill="#fff"/></svg>`);
    await sharp(sky).png().toFile(file("sky.png"));
    const m = await ready("sky.png");
    expect(brightness(m.mean)).toBe(1);
    const crop = { x: 0, y: 0, w: 1, h: 0.25 };
    await until(() => !!sized(m, 400, 100, { crop }), "the sky, cropped", 10_000);
    const top = await sharp(sized(m, 400, 100, { crop })!.png).extract({ left: 0, top: 0, width: 400, height: 100 }).png().toBuffer();
    expect(await meanOf(top)).toBeLessThanOrEqual(MAX_MEAN + 0.03);
    // White at 30% opacity shows as a dim grey on the door's ground: not dimmed further.
    await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.3 } } }).png().toFile(file("veil.png"));
    const veil = await ready("veil.png");
    expect(veil.mean).toBeCloseTo(0.3, 1);
    expect(brightness(veil.mean)).toBeGreaterThan(0.95);
  });

  test("a file changed on disk is read again", async () => {
    const m = await ready("small.png");
    await sharp({ create: { width: 300, height: 100, channels: 3, background: { r: 10, g: 60, b: 20 } } }).png().toFile(file("small.png"));
    utimesSync(file("small.png"), new Date(), new Date(Date.now() + 5000));
    await until(() => { const x = media(file("small.png"), "img"); return x.state === "ready" && x.width === 300; }, "the new size", 10_000);
    expect(m.width).toBe(200);
    // The old reading draws nothing any more: never the old picture for the new file.
    expect(sized(m, 400, 200)).toBeNull();
  });

  test("a missing file says so", () => {
    expect(media(file("nope.png"), "img")).toMatchObject({ state: "error", reason: "file not found" });
  });
});

describe("the reader draws the header image above the title", () => {
  const note = (text: string) => ({ id: "41111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} });
  const host = (graphics: boolean): SurfaceHost => ({
    ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cols: 100, rows: 40, cellW: 10, cellH: 20, kitty: graphics }, graphics } as any,
    redraw() {}, navigate() {},
  });
  const body = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

  test("full width, at most a third of the pane, cropped to fill; the note under it; its line only a caption", async () => {
    await ready("wide.jpg");
    const s = new NoteSurface(), h = host(true), m = note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\nBeans.`);
    s.show(m as any, h);
    // Its rows are kept dark until the PNG dimmed for the part it shows is ready.
    await until(() => !!s.render(100, 42, h).placements?.length, "the header, scaled", 10_000);
    const v = s.render(100, 42, h);
    const hero = v.placements![0]!;
    // 25 rows tall at the full width, the cap 14: cropped to fill, around its middle.
    expect(hero).toMatchObject({ col: 0, row: 0, cols: 100, rows: 14 });
    expect(hero.crop!.w).toBe(hero.image.width);
    expect(hero.crop!.h / hero.image.height).toBeCloseTo(14 / 25, 1);
    const lines = v.lines.map(plain);
    expect(lines.length).toBeLessThanOrEqual(42);
    expect(lines.slice(0, 14).every(l => !l.trim())).toBe(true);
    expect(lines[14]).toContain("Plot");
    expect(lines.find(l => l.includes("▀ header wide.jpg"))).toContain("[▀ ✓]");
    expect(v.placements).toHaveLength(1);
    // A click on the header makes its image the [ ] position.
    expect(s.click(5, 3, h)).toBe(true);
    // A pane too short for it, or no graphics: the header is drawn where it's written, or only named.
    expect(s.render(100, 12, h).lines.map(plain)[0]).toContain("Plot");
    const off = new NoteSurface(), ho = host(false);
    off.show(m as any, ho);
    expect(off.render(100, 42, ho).lines.map(plain).join("\n")).toContain("▀ header wide.jpg · no Kitty graphics in this terminal · 1200×600");
  });

  test("it scrolls away with the top of the note, and the note still scrolls to its last line", async () => {
    await ready("wide.jpg");
    const s = new NoteSurface(), h = host(true);
    s.show(note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\n${body(60)}`) as any, h);
    await until(() => !!s.render(100, 42, h).placements?.length, "the header, scaled", 10_000);
    const first = s.render(100, 42, h).placements![0]!;
    (s as any).scroll = 4;
    s.render(100, 42, h);
    const sv = s.render(100, 42, h), top = sv.placements![0]!;
    expect(top).toMatchObject({ row: 0, rows: 10 });
    expect(top.crop!.y).toBeGreaterThan(first.crop!.y);
    expect(plain(sv.lines[10]!)).toContain("Plot");
    // Clicks land on the rows drawn: the header's 10 rows are above the title.
    expect(s.sourceLineAt(10 + 5)).not.toBeNull();
    (s as any).scroll = 1e6;
    const end = s.render(100, 42, h).lines.map(plain);
    expect(end[0]).toContain("Plot");
    expect(end.join("\n")).toContain("line 59");
    // A short note scrolls only as far as its last line shows, whatever its length.
    for (let n = 20; n <= 46; n++) {
      const short = new NoteSurface();
      short.show(note(`Plot\n- [img::${file("wide.jpg")}] [layout::hero]\n\n${body(n)}`) as any, h);
      short.render(100, 42, h);
      (short as any).scroll = 1e6;
      const sl = short.render(100, 42, h).lines.map(plain);
      expect(sl.join("\n")).toContain(`line ${n - 1}`);
    }
  });

  test("without a reader (a river column, ep0ch show) the header is drawn where it is written, full width", async () => {
    await ready("wide.jpg");
    const env: DocEnv = { width: 80, cellW: 10, cellH: 20, graphics: true, maxImageRows: 8, unfold: true };
    const d = renderDoc(`[img::${file("wide.jpg")}] [layout::hero]`, env);
    expect(d.images[0]).toMatchObject({ col: 0, cols: 80, rows: 8, crop: { x: 0, w: 1 } });
    expect(d.media[0]!.image).toBe(0);
    expect(d.hero).toBeUndefined();
  });
});
